# Quant prototype (root-level Python files)

The first backend prototype, kept for reference: `engine.py`, `models.py`, `api.py`, `__init__.py` and the
`test_*.py` scripts at the repository root. The maintained backend is [`engine/`](../engine/README.md), which
re-implements the parts we kept (CAPM attribution without look-ahead, unusual-move z-scores, approval
routing with a portfolio-level VaR budget) and drops the parts that sell to cash (ATR stop-loss, SGOV
beta shield).

## Core Mathematical Applications Implemented

### 1. News-Reactive Dynamic Stop-Loss (`evaluate_dynamic_stop_loss`)
* **True Range ($\text{TR}_t$) & $n$-Period Average True Range ($\text{ATR}_n$):**
  $$\text{TR}_t = \max\bigl(H_t - L_t,\; |H_t - C_{t-1}|,\; |L_t - C_{t-1}|\bigr), \qquad \text{ATR}_n = \frac{1}{n}\sum_{i=1}^{n} \text{TR}_{t-i+1}$$
* **Net FinBERT Sentiment Score ($S_{\text{news}}$) & Multiplier ($M_{\text{news}}$):**
  $$S_{\text{news}} = P_+ - P_-, \qquad M_{\text{news}} = \max\bigl(m_{\min},\; 1 + S_{\text{news}}\bigr)$$
* **Dynamic Stop-Loss Price ($P_{\text{stop}}$):**
  $$P_{\text{stop}} = P_{\text{peak}} - \bigl(k \cdot \text{ATR}_n \cdot M_{\text{news}}\bigr)$$

### 2. "Sleep Soundly" Mode — Portfolio Beta Reduction (`calculate_sleep_soundly_rebalance`)
* **Asset Beta ($\beta_i$) & Total Portfolio Beta ($\beta_p$):**
  $$\beta_i = \frac{\text{Cov}(r_i, r_m)}{\text{Var}(r_m)}, \qquad w_i = \frac{V_i}{V_{\text{total}}}, \qquad \beta_p = \sum_{i=1}^{N} w_i \beta_i$$
* **Dollar Capital to Rotate from High-Beta Asset ($H$) to Safe-Haven Asset ($\beta_{rf} \approx 0$):**
  $$\Delta V_H = V_{\text{total}} \cdot \frac{\beta_p - \beta_{\text{target}}}{\beta_H - \beta_{rf}}$$

### 3. "Why Is My Portfolio Bleeding?" — Single-Index CAPM Attribution (`calculate_portfolio_attribution`)
* **Single-Asset & Total Portfolio Return Decomposition:**
  $$r_i = \beta_i r_m + \alpha_i, \qquad R_p = \sum_{i=1}^{N} w_i r_i = \underbrace{\left(\sum_{i=1}^{N} w_i \beta_i\right) r_m}_{\text{Macro / Market Component}} + \underbrace{\sum_{i=1}^{N} w_i \alpha_i}_{\text{Idiosyncratic Component}}$$

### 4. Quant Anomaly & Momentum Detection (`detect_anomalies_and_momentum`)
* **Rolling Volatility ($\sigma_i$) & Return Z-Score ($Z_{i,t}$):**
  $$\sigma_i = \sqrt{\frac{1}{n-1}\sum_{k=1}^{n} (r_{i,t-k+1} - \bar{r}_i)^2}, \qquad Z_{i,t} = \frac{r_{i,t} - \bar{r}_i}{\sigma_i}$$
* **$n$-Period Relative Strength Index ($\text{RSI}_n$):**
  $$\text{RS}_n = \frac{\frac{1}{n}\sum_{k=1}^{n} \max(0,\, \Delta P_{t-k+1})}{\frac{1}{n}\sum_{k=1}^{n} \max(0,\, -\Delta P_{t-k+1})}, \qquad \text{RSI}_n = 100 - \frac{100}{1 + \text{RS}_n}$$

### 5. "Hype-Check" Guardrail — Concentration & Parametric $\text{VaR}_{95}$ (`evaluate_hype_check_guardrail`)
* **Trade Concentration Ratio ($C_{\text{trade}}$) & 1-Day Value-at-Risk ($\text{VaR}_{\alpha}$):**
  $$C_{\text{trade}} = \frac{Q_{\text{trade}} \cdot P_i}{V_{\text{total}}}, \qquad \text{VaR}_{\alpha} = V_{\text{position}} \cdot z_{\alpha} \cdot \sigma_i$$

---

## Quickstart

### 1. Run Live `yfinance` Verification Suite
```bash
pip install -r requirements.txt
python test_real_world_data.py
```

### 2. Run Mathematical Regression Test Suite
```bash
python test_regression_suite.py
```

### 3. Start the prototype FastAPI server
```bash
uvicorn quant_backend.api:app --reload --port 8000
```
