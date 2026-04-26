use soroban_sdk::{String, Vec};

/// Check if string contains blocked words (case-insensitive)
pub fn contains_blocked_word(text: &str, blocked_words: &Vec<String>) -> bool {
    let text_lower = text.to_lowercase();

    for blocked in blocked_words.iter() {
        let blocked_lower = blocked.to_string().to_lowercase();
        if text_lower.contains(&blocked_lower) {
            return true;
        }
    }

    false
}

/// Check if string contains special characters (only allows alphanumeric and spaces)
pub fn contains_special_chars(text: &str) -> bool {
    for c in text.chars() {
        if !c.is_alphanumeric() && c != ' ' {
            return true;
        }
    }
    false
}

/// Check if string is all uppercase
pub fn is_uppercase(text: &str) -> bool {
    for c in text.chars() {
        if c.is_alphabetic() && !c.is_uppercase() {
            return false;
        }
    }
    true
}

/// Check if string is numeric only
pub fn is_numeric_only(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }

    for c in text.chars() {
        if !c.is_numeric() && c != ' ' {
            return false;
        }
    }
    true
}

/// Check for repeated characters (e.g., "aaaa", "1111")
pub fn has_repeated_characters(text: &str, threshold: usize) -> bool {
    if text.len() < threshold {
        return false;
    }

    let chars: Vec<char> = text.chars().collect();
    let mut count = 1;

    for i in 1..chars.len() {
        if chars[i] == chars[i - 1] {
            count += 1;
            if count >= threshold {
                return true;
            }
        } else {
            count = 1;
        }
    }

    false
}

/// Check for suspicious patterns
pub fn contains_suspicious_pattern(text: &str) -> bool {
    let text_lower = text.to_lowercase();

    // Common scam/phishing patterns
    let suspicious_patterns = [
        "airdrop",
        "free token",
        "guaranteed",
        "double your",
        "get rich",
        "100x",
        "1000x",
        "moon",
        "lambo",
        "official",
        "elon",
        "musk",
        "binance",
        "coinbase",
        "metamask",
        "wallet connect",
        "claim now",
        "limited time",
        "act fast",
        "send to",
        "private key",
        "seed phrase",
        "recovery phrase",
    ];

    for pattern in suspicious_patterns.iter() {
        if text_lower.contains(pattern) {
            return true;
        }
    }

    false
}

/// Check for misleading Unicode characters
pub fn contains_misleading_unicode(text: &str) -> bool {
    for c in text.chars() {
        let code = c as u32;

        // Check for homoglyphs and confusables
        // Cyrillic lookalikes
        if (0x0400..=0x04FF).contains(&code) {
            // Allow if entire text is Cyrillic
            if !is_all_cyrillic(text) {
                return true;
            }
        }

        // Greek lookalikes
        if (0x0370..=0x03FF).contains(&code) {
            if !is_all_greek(text) {
                return true;
            }
        }

        // Zero-width characters
        if code == 0x200B || code == 0x200C || code == 0x200D || code == 0xFEFF {
            return true;
        }

        // Right-to-left override
        if code == 0x202E {
            return true;
        }

        // Combining characters (excessive use)
        if (0x0300..=0x036F).contains(&code) {
            return true;
        }
    }

    false
}

/// Check if text is all Cyrillic
fn is_all_cyrillic(text: &str) -> bool {
    for c in text.chars() {
        if c.is_alphabetic() {
            let code = c as u32;
            if !(0x0400..=0x04FF).contains(&code) {
                return false;
            }
        }
    }
    true
}

/// Check if text is all Greek
fn is_all_greek(text: &str) -> bool {
    for c in text.chars() {
        if c.is_alphabetic() {
            let code = c as u32;
            if !(0x0370..=0x03FF).contains(&code) {
                return false;
            }
        }
    }
    true
}

/// Check for spam patterns in descriptions
pub fn contains_spam_pattern(text: &str) -> bool {
    let text_lower = text.to_lowercase();

    // Count URLs
    let url_count = text_lower.matches("http").count() + text_lower.matches("www.").count();
    if url_count > 2 {
        return true;
    }

    // Check for excessive emojis/special characters
    let special_count = text.chars().filter(|c| !c.is_alphanumeric() && *c != ' ').count();
    if special_count > text.len() / 3 {
        return true;
    }

    // Check for excessive capitalization
    let caps_count = text.chars().filter(|c| c.is_uppercase()).count();
    let alpha_count = text.chars().filter(|c| c.is_alphabetic()).count();
    if alpha_count > 0 && caps_count > (alpha_count * 2 / 3) {
        return true;
    }

    // Check for telegram/discord spam
    if text_lower.contains("t.me/") || text_lower.contains("discord.gg/") {
        return true;
    }

    false
}

/// Check for impersonation patterns
pub fn contains_impersonation_pattern(text: &str) -> bool {
    let text_lower = text.to_lowercase();

    // Common impersonation targets
    let targets = [
        "bitcoin",
        "ethereum",
        "stellar",
        "soroban",
        "usdt",
        "usdc",
        "dai",
        "wrapped",
        "official",
        "foundation",
    ];

    for target in targets.iter() {
        if text_lower.contains(target) {
            // Check for variations like "Bitcoin2", "EthereumX", etc.
            if text_lower.contains(&format!("{}2", target))
                || text_lower.contains(&format!("{}x", target))
                || text_lower.contains(&format!("new {}", target))
                || text_lower.contains(&format!("{} 2.0", target))
            {
                return true;
            }
        }
    }

    false
}

/// Calculate text entropy (randomness) - higher = more random
pub fn calculate_entropy(text: &str) -> u32 {
    if text.is_empty() {
        return 0;
    }

    let mut char_counts: [u32; 256] = [0; 256];
    let mut total = 0u32;

    for c in text.chars() {
        let byte = (c as u32 % 256) as usize;
        char_counts[byte] += 1;
        total += 1;
    }

    let mut entropy = 0.0f64;
    for &count in char_counts.iter() {
        if count > 0 {
            let probability = count as f64 / total as f64;
            entropy -= probability * probability.log2();
        }
    }

    // Scale to 0-100
    (entropy * 20.0).min(100.0) as u32
}

/// Check if text looks like random gibberish
pub fn is_gibberish(text: &str) -> bool {
    // Very high entropy suggests random characters
    let entropy = calculate_entropy(text);
    if entropy > 80 {
        return true;
    }

    // Check for lack of vowels (in Latin text)
    let vowels = ['a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U'];
    let vowel_count = text.chars().filter(|c| vowels.contains(c)).count();
    let alpha_count = text.chars().filter(|c| c.is_alphabetic()).count();

    if alpha_count > 5 && vowel_count == 0 {
        return true;
    }

    false
}

/// Check for excessive punctuation
pub fn has_excessive_punctuation(text: &str) -> bool {
    let punct_chars = ['!', '?', '.', ',', ';', ':', '-', '_'];
    let punct_count = text.chars().filter(|c| punct_chars.contains(c)).count();

    // More than 30% punctuation is suspicious
    punct_count > text.len() / 3
}
