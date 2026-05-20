export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_KEY;
  if (!openaiKey && !anthropicKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY or ANTHROPIC_KEY must be set in environment variables",
    });
  }

  try {
    const useOpenAI = Boolean(openaiKey);
    const useAnthropic = Boolean(anthropicKey);

    if (!useOpenAI) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({
          error: data.error?.message || "Anthropic API error",
        });
      }

      return res.status(200).json(data);
    }

    const chatModels = [req.body.model || "gpt-4o-mini", "gpt-3.5-turbo"];
    let lastResponse;
    let lastData;
    let openAIError;

    for (const model of chatModels) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: req.body.messages,
          max_tokens: req.body.max_tokens,
        }),
      });

      lastResponse = response;
      lastData = await response.json().catch(() => null);

      if (response.ok) {
        return res.status(200).json(lastData);
      }

      const errorType = lastData?.error?.type || lastData?.error?.code;
      if (response.status === 402 || errorType === "insufficient_quota") {
        openAIError = lastData?.error?.message ||
          "Your OpenAI key has insufficient quota or billing is not enabled. Update your key or add billing to continue.";
        break;
      }

      if (response.status !== 429) {
        return res.status(response.status).json({
          error: lastData?.error?.message || "OpenAI API error",
        });
      }

      openAIError = lastData?.error?.message || "OpenAI rate limit exceeded.";
    }

    if (openAIError && useAnthropic) {
      const anthroResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(req.body),
      });

      const anthroData = await anthroResponse.json().catch(() => null);
      if (anthroResponse.ok) {
        return res.status(200).json(anthroData);
      }

      return res.status(anthroResponse.status).json({
        error: anthroData?.error?.message || "Anthropic API error",
      });
    }

    return res.status(lastResponse.status).json({
      error: openAIError || lastData?.error?.message || "OpenAI API error",
    });
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
