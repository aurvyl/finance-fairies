"""One tool-calling loop over several LLM providers. Gemini is the default.

Every provider gets the same tools (plain JSON-schema functions backed by engine code) and
must finish by calling the `final_tool`. The model never trades: it reads engine numbers,
proposes weights, and our code checks and executes.

Keys come from the request (never stored), then the environment, then engine/.env.local.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"

PROVIDERS: dict[str, dict[str, Any]] = {
    "gemini": {
        "label": "Google Gemini (recommended)",
        "default_model": "gemini-4-argon",
        "fast_model": "gemini-3.8-flash",
        "env": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        "features": ["function_calling", "code_execution", "google_search"],
    },
    "openai": {
        "label": "OpenAI",
        "default_model": "gpt-5",
        "env": ["OPENAI_API_KEY"],
        "features": ["function_calling"],
    },
    "anthropic": {
        "label": "Anthropic Claude",
        "default_model": "claude-opus-5-5",
        "env": ["ANTHROPIC_API_KEY"],
        "features": ["function_calling"],
    },
    "openrouter": {
        "label": "OpenRouter (any model)",
        "default_model": "openrouter/auto",
        "env": ["OPENROUTER_API_KEY"],
        "base_url": "https://openrouter.ai/api/v1",
        "features": ["function_calling"],
    },
}


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    fn: Callable[[dict], Any] | None = None  # None for the final tool


@dataclass
class AgentRun:
    provider: str
    model: str
    final: dict | None = None
    text: str = ""
    trace: list[dict] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)
    error: str | None = None


def _env_file() -> dict[str, str]:
    if not ENV_FILE.exists():
        return {}
    out = {}
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def resolve_key(provider: str, explicit: str | None = None) -> str | None:
    if explicit:
        return explicit
    file_vals = _env_file()
    for name in PROVIDERS[provider]["env"]:
        if os.environ.get(name):
            return os.environ[name]
        if file_vals.get(name):
            return file_vals[name]
    return None


def provider_status() -> list[dict]:
    """What the settings screen shows: each provider, its default model and whether a key is configured."""
    return [
        {"id": pid, "label": p["label"], "default_model": p["default_model"], "features": p["features"],
         "key_configured": resolve_key(pid) is not None, "recommended": pid == "gemini"}
        for pid, p in PROVIDERS.items()
    ]


def _run_tool(tool: Tool, args: dict, run: AgentRun) -> str:
    try:
        result = tool.fn(args) if tool.fn else {"error": "not callable"}
    except Exception as exc:  # the model sees the error and can retry
        result = {"error": f"{type(exc).__name__}: {exc}"}
    run.trace.append({"tool": tool.name, "args": args, "result": result})
    return json.dumps(result, default=float)


def run_agent(
    provider: str,
    system: str,
    prompt: str,
    tools: list[Tool],
    final_tool: str,
    model: str | None = None,
    api_key: str | None = None,
    max_turns: int = 8,
    code_execution: bool = True,
    web_search: bool = False,
    thinking_level: str | None = "low",
) -> AgentRun:
    if provider not in PROVIDERS:
        raise ValueError(f"unknown provider {provider!r}; choose one of {list(PROVIDERS)}")
    model = model or PROVIDERS[provider]["default_model"]
    run = AgentRun(provider=provider, model=model)
    key = resolve_key(provider, api_key)
    if not key:
        run.error = f"no API key for {provider}: set {PROVIDERS[provider]['env'][0]} in engine/.env.local"
        return run
    loop = {"gemini": _gemini, "openai": _openai_compat, "openrouter": _openai_compat, "anthropic": _anthropic}[provider]
    try:
        loop(run, key, system, prompt, tools, final_tool, max_turns, code_execution=code_execution, web_search=web_search,
             thinking_level=thinking_level)
    except Exception as exc:
        run.error = f"{type(exc).__name__}: {exc}"
    return run


def _gemini(run, key, system, prompt, tools, final_tool, max_turns, code_execution, web_search, thinking_level):
    """Gemini Interactions API: function tools plus built-in code execution and Google Search.

    thinking_level "low" keeps one decision fast enough for a live demo; the engine already did the maths.
    """
    from google import genai

    client = genai.Client(api_key=key)
    by_name = {t.name: t for t in tools}
    params: list[dict] = [{"type": "function", "name": t.name, "description": t.description, "parameters": t.parameters} for t in tools]
    if code_execution:
        params.append({"type": "code_execution"})
    if web_search:
        params.append({"type": "google_search"})

    config = {"thinking_level": thinking_level} if thinking_level else None
    extra = {"generation_config": config} if config else {}
    if params:
        extra["tools"] = params
    inter = client.interactions.create(model=run.model, system_instruction=system, input=prompt, **extra)
    seen: set[str] = set()
    for _ in range(max_turns):
        _collect_sources(inter.model_dump(), run.sources)
        calls = [s for s in (inter.steps or []) if getattr(s, "type", None) == "function_call" and s.id not in seen]
        if not calls:
            run.text = inter.output_text or ""
            return
        results = []
        for c in calls:
            seen.add(c.id)
            if c.name == final_tool:
                run.final = dict(c.arguments)
                run.text = inter.output_text or ""
                return
            out = _run_tool(by_name[c.name], dict(c.arguments), run) if c.name in by_name else json.dumps({"error": "unknown tool"})
            results.append({"type": "function_result", "call_id": c.id, "name": c.name, "result": out})
        inter = client.interactions.create(
            model=run.model, system_instruction=system, previous_interaction_id=inter.id, input=results, **extra
        )


def gemini_grounded(prompt: str, model: str | None = None, api_key: str | None = None,
                    thinking_level: str | None = "low") -> dict:
    """One Google-Search-grounded Gemini answer with its url citations: {"text", "sources", "error"}."""
    key = resolve_key("gemini", api_key)
    if not key:
        return {"text": "", "sources": [], "error": "no GEMINI_API_KEY"}
    from google import genai

    client = genai.Client(api_key=key)  # keep a reference: a dropped client closes its connection
    try:
        inter = client.interactions.create(
            model=model or PROVIDERS["gemini"]["default_model"], input=prompt, tools=[{"type": "google_search"}],
            **({"generation_config": {"thinking_level": thinking_level}} if thinking_level else {}),
        )
    except Exception as exc:
        return {"text": "", "sources": [], "error": f"{type(exc).__name__}: {exc}"}
    sources: list[dict] = []
    _collect_sources(inter.model_dump(), sources)
    return {"text": inter.output_text or "", "sources": sources, "error": None}


def _collect_sources(node: Any, out: list[dict]) -> None:
    """Pull url citations (Google Search grounding) out of the interaction payload."""
    if isinstance(node, dict):
        if isinstance(node.get("url"), str) and node["url"].startswith("http"):
            item = {"url": node["url"], "title": node.get("title")}
            if item not in out:
                out.append(item)
        for v in node.values():
            _collect_sources(v, out)
    elif isinstance(node, list):
        for v in node:
            _collect_sources(v, out)


def _openai_compat(run, key, system, prompt, tools, final_tool, max_turns, **_):
    """OpenAI Chat Completions; OpenRouter speaks the same protocol."""
    from openai import OpenAI

    client = OpenAI(api_key=key, base_url=PROVIDERS[run.provider].get("base_url"))
    by_name = {t.name: t for t in tools}
    spec = [{"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}} for t in tools]
    messages: list[dict] = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    for _ in range(max_turns):
        msg = client.chat.completions.create(model=run.model, messages=messages, **({"tools": spec} if spec else {})).choices[0].message
        if not msg.tool_calls:
            run.text = msg.content or ""
            return
        messages.append(msg.model_dump(exclude_none=True))
        for tc in msg.tool_calls:
            args = json.loads(tc.function.arguments or "{}")
            if tc.function.name == final_tool:
                run.final = args
                run.text = msg.content or ""
                return
            out = _run_tool(by_name[tc.function.name], args, run) if tc.function.name in by_name else json.dumps({"error": "unknown tool"})
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": out})


def _anthropic(run, key, system, prompt, tools, final_tool, max_turns, **_):
    """Anthropic Messages API manual tool loop (tool_choice stays auto; the prompt names the final tool)."""
    import anthropic

    # Explicit base_url so a proxy variable set for other tools on this machine is not picked up.
    client = anthropic.Anthropic(api_key=key, base_url=os.environ.get("GUARDIAN_ANTHROPIC_BASE_URL", "https://api.anthropic.com"))
    by_name = {t.name: t for t in tools}
    spec = [{"name": t.name, "description": t.description, "input_schema": t.parameters} for t in tools]
    messages: list[dict] = [{"role": "user", "content": prompt}]
    for _ in range(max_turns):
        resp = client.messages.create(
            model=run.model,
            max_tokens=16000,
            system=system,
            messages=messages,
            **({"tools": spec} if spec else {}),
            # Route refused requests to a fallback model server-side instead of failing the plan.
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            extra_body={"fallbacks": "default"},
        )
        if resp.stop_reason == "refusal":
            run.error = "model declined the request"
            return
        text = "".join(b.text for b in resp.content if b.type == "text")
        uses = [b for b in resp.content if b.type == "tool_use"]
        if not uses:
            run.text = text
            return
        messages.append({"role": "assistant", "content": resp.content})
        results = []
        for u in uses:
            if u.name == final_tool:
                run.final = dict(u.input)
                run.text = text
                return
            out = _run_tool(by_name[u.name], dict(u.input), run) if u.name in by_name else json.dumps({"error": "unknown tool"})
            results.append({"type": "tool_result", "tool_use_id": u.id, "content": out})
        messages.append({"role": "user", "content": results})
