export default async function handler(req, res) {
  try {
    const { net = "bsc", address = "" } = req.query;

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: "Invalid address" });
    }

    const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
    if (!MORALIS_API_KEY) {
      return res.status(500).json({ error: "Server missing MORALIS_API_KEY" });
    }

    // Moralis chain ids: eth | bsc | polygon
    const chain =
      net === "eth" ? "eth" :
      net === "polygon" ? "polygon" :
      "bsc";

    // Moralis: GET /api/v2.2/wallets/:address/approvals?chain=...
    const url = `https://deep-index.moralis.io/api/v2.2/wallets/${address}/approvals?chain=${chain}`;
    const r = await fetch(url, {
      headers: {
        accept: "application/json",
        "X-API-Key": MORALIS_API_KEY
      }
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(502).json({ error: "Moralis failed", status: r.status, body: text.slice(0, 300) });
    }

    const data = await r.json();

    // data.result is typical; handle a couple shapes safely
    const items = Array.isArray(data?.result) ? data.result : (Array.isArray(data) ? data : []);

    // Minimal normalization to your PDF schema:
    // [{ token, spender, allowance, symbol, verified, lastUpdated, flags, risk }]
    const approvals = items.map((x) => {
      const token = x?.token?.address || x?.token_address || x?.tokenAddress || "";
      const spender = x?.spender?.address || x?.spender_address || x?.spenderAddress || "";
      const symbol = x?.token?.symbol || x?.token_symbol || "—";

      // Moralis sometimes provides allowance / value fields; keep string
      const allowance = String(x?.allowance ?? x?.value ?? x?.amount ?? "0");

      // We will fill verified/lastUpdated/flags/risk best-effort here (MVP),
      // and you can enrich further later.
      const verified = "—";      // Step 4B will enrich using explorer API if you want
      const lastUpdated = x?.block_timestamp || x?.updated_at || x?.blockTime || "—";

      // flags/suspicious heuristics (MVP)
      const flagsArr = [];
      const alw = allowance.toLowerCase();
      if (alw === "infinite" || alw === "∞" || alw.includes("inf")) flagsArr.push("infinite");

      // risk heuristic (MVP)
      const risk =
        flagsArr.includes("infinite") ? "High" :
        "Low";

      return {
        token,
        spender,
        allowance,
        symbol,
        verified,
        lastUpdated,
        flags: flagsArr.length ? flagsArr : "—",
        risk
      };
    });

    // score + tips (MVP server-side)
    let score = 100;
    const high = approvals.filter(a => String(a.risk).toLowerCase().includes("high")).length;
    score = Math.max(0, score - high * 15);

    const riskLevel = score >= 80 ? "Low" : score >= 50 ? "Medium" : "High";
    const tips = [];
    if (high) tips.push(`Revoke high-risk approvals first (${high}).`);
    else tips.push("No major red flags detected. Keep monitoring regularly.");

    return res.status(200).json({
      score,
      riskLevel,
      tips,
      approvals
    });

  } catch (e) {
    return res.status(500).json({ error: "Server error", message: String(e?.message || e) });
  }
}
