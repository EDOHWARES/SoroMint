#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

#[test]
fn test_initialize() {
    let env = Env::default();
    let admin = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    assert!(is_verifier(&env, &admin));
    assert_eq!(get_certificate_count(&env), 0);
    assert!(is_public_display_enabled(&env));
}

#[test]
fn test_add_remove_verifier() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    add_verifier(&env, admin.clone(), verifier.clone());
    
    assert!(is_verifier(&env, &verifier));
    
    remove_verifier(&env, admin.clone(), verifier.clone());
    assert!(!is_verifier(&env, &verifier));
}

#[test]
fn test_record_burn() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let burner = Address::generate(&env);
    let token = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    let tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let metadata = String::from_str(&env, r#"{"purpose":"deflationary"}"#);
    
    let cert_id = record_burn(
        &env,
        burner.clone(),
        token.clone(),
        1000,
        BurnReason::Deflationary,
        tx_hash.clone(),
        metadata.clone(),
    );
    
    assert_eq!(cert_id, 0);
    assert_eq!(get_certificate_count(&env), 1);
    
    let cert = get_certificate(&env, cert_id).unwrap();
    assert_eq!(cert.certificate_id, 0);
    assert_eq!(cert.burner, burner);
    assert_eq!(cert.token_address, token);
    assert_eq!(cert.amount, 1000);
    assert_eq!(cert.status, CertificateStatus::Active);
    assert_eq!(cert.verifier, None);
}

#[test]
fn test_verify_certificate() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let burner = Address::generate(&env);
    let token = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    let tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let metadata = String::from_str(&env, "{}");
    
    let cert_id = record_burn(
        &env,
        burner.clone(),
        token.clone(),
        1000,
        BurnReason::CrossChainBridge,
        tx_hash,
        metadata,
    );
    
    verify_certificate(&env, admin.clone(), cert_id);
    
    let cert = get_certificate(&env, cert_id).unwrap();
    assert_eq!(cert.status, CertificateStatus::Verified);
    assert_eq!(cert.verifier, Some(admin));
}

#[test]
fn test_revoke_certificate() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let burner = Address::generate(&env);
    let token = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    let tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let metadata = String::from_str(&env, "{}");
    
    let cert_id = record_burn(
        &env,
        burner.clone(),
        token.clone(),
        1000,
        BurnReason::Redemption,
        tx_hash,
        metadata,
    );
    
    revoke_certificate(&env, admin.clone(), cert_id);
    
    let cert = get_certificate(&env, cert_id).unwrap();
    assert_eq!(cert.status, CertificateStatus::Revoked);
}

#[test]
fn test_get_burner_certificates() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let burner = Address::generate(&env);
    let token = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    // Record multiple burns
    for i in 0..3 {
        let tx_hash = BytesN::from_array(&env, &[i as u8; 32]);
        let metadata = String::from_str(&env, "{}");
        
        record_burn(
            &env,
            burner.clone(),
            token.clone(),
            1000 * (i as i128 + 1),
            BurnReason::Deflationary,
            tx_hash,
            metadata,
        );
    }
    
    let burner_certs = get_burner_certificates(&env, burner);
    assert_eq!(burner_certs.len(), 3);
    assert_eq!(burner_certs.get(0).unwrap(), 0);
    assert_eq!(burner_certs.get(1).unwrap(), 1);
    assert_eq!(burner_certs.get(2).unwrap(), 2);
}

#[test]
fn test_get_token_certificates() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let burner1 = Address::generate(&env);
    let burner2 = Address::generate(&env);
    let token = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    // Record burns from different burners for same token
    let tx_hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let tx_hash2 = BytesN::from_array(&env, &[2u8; 32]);
    let metadata = String::from_str(&env, "{}");
    
    record_burn(
        &env,
        burner1,
        token.clone(),
        1000,
        BurnReason::Deflationary,
        tx_hash1,
        metadata.clone(),
    );
    
    record_burn(
        &env,
        burner2,
        token.clone(),
        2000,
        BurnReason::Deflationary,
        tx_hash2,
        metadata,
    );
    
    let token_certs = get_token_certificates(&env, token.clone());
    assert_eq!(token_certs.len(), 2);
    
    let total_burned = get_total_burned(&env, token);
    assert_eq!(total_burned, 3000);
}

#[test]
fn test_get_certificates() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let burner = Address::generate(&env);
    let token = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    // Record multiple burns
    for i in 0..5 {
        let tx_hash = BytesN::from_array(&env, &[i as u8; 32]);
        let metadata = String::from_str(&env, "{}");
        
        record_burn(
            &env,
            burner.clone(),
            token.clone(),
            1000,
            BurnReason::Deflationary,
            tx_hash,
            metadata,
        );
    }
    
    assert_eq!(get_certificate_count(&env), 5);
    
    // Get certificates 0-3
    let certs = get_certificates(&env, 0, 3);
    assert_eq!(certs.len(), 3);
    assert_eq!(certs.get(0).unwrap().certificate_id, 0);
    assert_eq!(certs.get(2).unwrap().certificate_id, 2);
}

#[test]
fn test_public_display_setting() {
    let env = Env::default();
    let admin = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    assert!(is_public_display_enabled(&env));
    
    set_public_display(&env, admin.clone(), false);
    assert!(!is_public_display_enabled(&env));
    
    set_public_display(&env, admin.clone(), true);
    assert!(is_public_display_enabled(&env));
}

#[test]
#[should_panic(expected = "Invalid burn amount")]
fn test_invalid_burn_amount() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let burner = Address::generate(&env);
    let token = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    let tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let metadata = String::from_str(&env, "{}");
    
    // Should panic with invalid amount
    record_burn(
        &env,
        burner,
        token,
        0, // Invalid amount
        BurnReason::Deflationary,
        tx_hash,
        metadata,
    );
}

#[test]
#[should_panic(expected = "Unauthorized: not a verifier")]
fn test_verify_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let burner = Address::generate(&env);
    let token = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    let tx_hash = BytesN::from_array(&env, &[1u8; 32]);
    let metadata = String::from_str(&env, "{}");
    
    let cert_id = record_burn(
        &env,
        burner,
        token,
        1000,
        BurnReason::Deflationary,
        tx_hash,
        metadata,
    );
    
    // Should panic - unauthorized verifier
    verify_certificate(&env, unauthorized, cert_id);
}

#[test]
fn test_burn_stats() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let burner = Address::generate(&env);
    let token = Address::generate(&env);
    
    env.mock_all_auths();
    
    initialize(&env, admin.clone());
    
    // Record multiple burns
    for i in 0..3 {
        let tx_hash = BytesN::from_array(&env, &[i as u8; 32]);
        let metadata = String::from_str(&env, "{}");
        
        record_burn(
            &env,
            burner.clone(),
            token.clone(),
            1000,
            BurnReason::Deflationary,
            tx_hash,
            metadata,
        );
    }
    
    let stats = get_burn_stats(&env);
    assert_eq!(stats.total_burns, 3);
    assert_eq!(stats.total_amount_burned, 3000);
}
