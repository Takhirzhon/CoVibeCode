/// Model pricing (per million tokens, USD).
pub struct ModelPricing {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

/// Get pricing for a model. Matches known Claude models, third-party provider models,
/// and falls back to Sonnet pricing for unknown models.
pub fn get_pricing(model: &str) -> ModelPricing {
    // ── Claude models ──
    // Legacy Opus (3.x, 4.0, 4.1) → $15 / $75. Must be checked BEFORE the generic
    // `opus` branch below, which now covers all modern Opus (4.5+) at $5 / $25.
    if model.contains("opus-4-0")
        || model.contains("opus-4.0")
        || model.contains("opus-4-1")
        || model.contains("opus-4.1")
        || model.contains("opus-3")
        || model.contains("3-opus")
    {
        return claude_pricing(15.0, 75.0);
    }
    // Modern Opus (4.5 / 4.6 / 4.7 / 4.8 and later) → $5 / $25.
    // Default the family to the current rate so a new Opus release isn't silently
    // billed at the legacy 3× rate (issue #149: Opus 4.8 was hitting $15/$75).
    if model.contains("opus") {
        return claude_pricing(5.0, 25.0);
    }
    if model.contains("haiku") {
        return claude_pricing(0.80, 4.0);
    }
    if model.contains("sonnet") {
        return claude_pricing(3.0, 15.0);
    }
    // OpenAI models
    if model.contains("gpt-4o") {
        return claude_pricing(2.5, 10.0);
    }
    if model.contains("gpt-4") {
        return claude_pricing(10.0, 30.0);
    }
    if model.contains("o1") || model.contains("o3") {
        return claude_pricing(15.0, 60.0);
    }

    // ── Third-party provider models ──
    // DeepSeek: deepseek-chat, deepseek-reasoner (V3.2 unified pricing)
    if model.contains("deepseek") {
        return ModelPricing {
            input: 0.28,
            output: 0.42,
            cache_read: 0.028,
            cache_write: 0.28,
        };
    }
    // Kimi / Moonshot
    if model.contains("kimi-k2.5") || model.contains("kimi-k25") {
        return ModelPricing {
            input: 0.60,
            output: 3.0,
            cache_read: 0.10,
            cache_write: 0.60,
        };
    }
    if model.contains("kimi") {
        return ModelPricing {
            input: 0.60,
            output: 2.50,
            cache_read: 0.15,
            cache_write: 0.60,
        };
    }
    // Zhipu GLM
    if model.contains("glm-4.5-flash") || model.contains("glm-4-5-flash") {
        return ModelPricing {
            input: 0.0,
            output: 0.0,
            cache_read: 0.0,
            cache_write: 0.0,
        };
    }
    if model.contains("glm-4.5-air") || model.contains("glm-4-5-air") {
        return ModelPricing {
            input: 0.20,
            output: 1.10,
            cache_read: 0.03,
            cache_write: 0.20,
        };
    }
    if model.contains("glm-4.7") || model.contains("glm-4-7") || model.contains("glm") {
        return ModelPricing {
            input: 0.60,
            output: 2.20,
            cache_read: 0.11,
            cache_write: 0.60,
        };
    }
    // Qwen / Bailian (lowest tier pricing)
    if model.contains("qwen3-max") {
        return ModelPricing {
            input: 1.20,
            output: 6.0,
            cache_read: 0.12,
            cache_write: 1.20,
        };
    }
    if model.contains("qwen3.5-plus") || model.contains("qwen35-plus") {
        return ModelPricing {
            input: 0.40,
            output: 2.40,
            cache_read: 0.04,
            cache_write: 0.40,
        };
    }
    if model.contains("qwen-plus") {
        return ModelPricing {
            input: 0.40,
            output: 1.20,
            cache_read: 0.04,
            cache_write: 0.40,
        };
    }
    if model.contains("qwen-flash") || model.contains("qwen") {
        return ModelPricing {
            input: 0.05,
            output: 0.40,
            cache_read: 0.005,
            cache_write: 0.05,
        };
    }
    // DouBao / Volcengine (lowest tier, CNY→USD @ ~7.2)
    if model.contains("doubao") {
        return ModelPricing {
            input: 0.17,
            output: 1.11,
            cache_read: 0.034,
            cache_write: 0.17,
        };
    }
    // MiniMax
    if model.contains("MiniMax-M2.5-highspeed") || model.contains("minimax-m2.5-highspeed") {
        return ModelPricing {
            input: 0.30,
            output: 2.40,
            cache_read: 0.03,
            cache_write: 0.30,
        };
    }
    if model.contains("MiniMax") || model.contains("minimax") {
        return ModelPricing {
            input: 0.30,
            output: 1.20,
            cache_read: 0.03,
            cache_write: 0.30,
        };
    }
    // MiMo / Xiaomi
    if model.contains("mimo") {
        return ModelPricing {
            input: 0.10,
            output: 0.30,
            cache_read: 0.01,
            cache_write: 0.10,
        };
    }

    // Default: Sonnet pricing
    claude_pricing(3.0, 15.0)
}

/// Standard Claude pricing: cache_read = 10% of input, cache_write = 125% of input.
fn claude_pricing(input: f64, output: f64) -> ModelPricing {
    ModelPricing {
        input,
        output,
        cache_read: input * 0.1,
        cache_write: input * 1.25,
    }
}

/// Whether the Claude Code CLI reports accurate cost for this model itself.
///
/// The CLI natively bills Claude (and OpenAI) models with correct pricing, so we
/// trust its reported `costUSD` for them. Third-party providers proxied through the
/// CLI get Claude-based pricing applied — which is wrong — so those we recalculate
/// via [`estimate_cost`]. (#149 / upstream #151)
pub fn is_native_pricing_model(model: &str) -> bool {
    let m = model.to_ascii_lowercase();
    m.contains("claude")
        || m.contains("opus")
        || m.contains("sonnet")
        || m.contains("haiku")
        || m.contains("gpt")
        || m.contains("o1")
        || m.contains("o3")
}

/// Estimate cost from token counts (input, output, cache read, cache write).
pub fn estimate_cost(
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
) -> f64 {
    let p = get_pricing(model);
    (input_tokens as f64 * p.input
        + output_tokens as f64 * p.output
        + cache_read_tokens as f64 * p.cache_read
        + cache_write_tokens as f64 * p.cache_write)
        / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #149: Opus 4.8 (and any modern Opus) must use $5/$25, not the legacy $15/$75.
    #[test]
    fn opus_4_8_uses_modern_rate() {
        for m in [
            "claude-opus-4-8",
            "opus-4-8",
            "opus-4.8",
            "claude-opus-4-7",
            "opus-4-5",
        ] {
            let p = get_pricing(m);
            assert_eq!(p.input, 5.0, "input rate for {m}");
            assert_eq!(p.output, 25.0, "output rate for {m}");
            assert_eq!(p.cache_read, 0.5, "cache_read rate for {m}");
        }
    }

    /// Legacy Opus (3.x / 4.0 / 4.1) stays at $15/$75.
    #[test]
    fn legacy_opus_uses_legacy_rate() {
        for m in [
            "claude-opus-4-1-20250805",
            "opus-4-0",
            "claude-3-opus-20240229",
        ] {
            let p = get_pricing(m);
            assert_eq!(p.input, 15.0, "input rate for {m}");
            assert_eq!(p.output, 75.0, "output rate for {m}");
        }
    }

    /// Concrete regression for the issue's example: a turn that should be ~$0.40 must not
    /// be billed at the legacy 3× rate (~$1.06 before the fix).
    #[test]
    fn opus_4_8_cost_not_inflated() {
        // 60k input + 6k output, mostly cache reads — representative of a coding turn.
        let cost = estimate_cost("claude-opus-4-8", 5_000, 6_000, 60_000, 10_000);
        let legacy = estimate_cost("claude-opus-4-1", 5_000, 6_000, 60_000, 10_000);
        assert!(cost < legacy, "modern Opus must cost less than legacy");
        // Modern: 5k*5 + 6k*25 + 60k*0.5 + 10k*6.25 = 25k+150k+30k+62.5k = 267.5k /1e6 = $0.2675
        assert!((cost - 0.2675).abs() < 1e-6, "got {cost}");
    }

    /// #151 refinement: native Claude/OpenAI models trust the CLI's own cost;
    /// third-party providers are recalculated from our table.
    #[test]
    fn native_pricing_model_classification() {
        for native in [
            "claude-opus-4-8",
            "claude-sonnet-4-6",
            "haiku",
            "gpt-4o",
            "o3-mini",
        ] {
            assert!(is_native_pricing_model(native), "{native} should be native");
        }
        for third_party in [
            "deepseek-chat",
            "kimi-k2.5",
            "glm-4.7",
            "qwen3-max",
            "MiniMax-M2.5",
            "doubao-pro",
        ] {
            assert!(
                !is_native_pricing_model(third_party),
                "{third_party} should be third-party"
            );
        }
    }
}
