#![cfg(test)]

mod test {
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, BytesN, Env, Symbol, Vec, IntoVal};

    use crate::MultiSigAccessControl;

    fn create_address(env: &Env, id: u32) -> Address {
        Address::from_contract_id(&env.register_test_contract_v2([], id).into())
    }

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_test_contract_v2([], 0);
        let client = MultiSigAccessControl::new(&env, contract_id.clone().into());

        let signer1 = create_address(&env, 1);
        let signer2 = create_address(&env, 2);
        let signer3 = create_address(&env, 3);

        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());
        signers.push_back(signer3.clone());

        client.initialize(&signers, &2);

        let config = client.get_config();
        assert_eq!(config.threshold, 2);
        assert_eq!(config.signers.len(), 3);
    }

    #[test]
    #[should_panic(expected = "invalid threshold")]
    fn test_initialize_invalid_threshold_zero() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_test_contract_v2([], 0);
        let client = MultiSigAccessControl::new(&env, contract_id.clone().into());

        let signer1 = create_address(&env, 1);
        let mut signers = Vec::new(&env);
        signers.push_back(signer1);

        client.initialize(&signers, &0);
    }

    #[test]
    #[should_panic(expected = "invalid threshold")]
    fn test_initialize_invalid_threshold_exceeds_signers() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_test_contract_v2([], 0);
        let client = MultiSigAccessControl::new(&env, contract_id.clone().into());

        let signer1 = create_address(&env, 1);
        let signer2 = create_address(&env, 2);
        let mut signers = Vec::new(&env);
        signers.push_back(signer1);
        signers.push_back(signer2);

        // Threshold of 3 with only 2 signers
        client.initialize(&signers, &3);
    }

    #[test]
    fn test_propose_and_approve_operation() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_test_contract_v2([], 0);
        let client = MultiSigAccessControl::new(&env, contract_id.clone().into());

        let signer1 = create_address(&env, 1);
        let signer2 = create_address(&env, 2);
        let signer3 = create_address(&env, 3);

        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());
        signers.push_back(signer3.clone());

        client.initialize(&signers, &2);

        // Propose operation
        let operation_id: BytesN<32> = [0u8; 32].into();
        let action = Symbol::new(&env, "withdraw_fees");
        client.propose_operation(&operation_id, &action, &signer1);

        // Verify operation is not executed yet
        assert!(!client.is_executed(&operation_id));

        // Approve with second signer
        client.approve_operation(&operation_id, &signer2);

        // Verify approval count
        let approval_count = client.get_approval_count(&operation_id);
        assert_eq!(approval_count, 2);

        // Execute operation
        let result = client.execute_operation(&operation_id);
        assert!(result);

        // Verify operation is executed
        assert!(client.is_executed(&operation_id));
    }

    #[test]
    #[should_panic(expected = "insufficient approvals")]
    fn test_execute_without_threshold() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_test_contract_v2([], 0);
        let client = MultiSigAccessControl::new(&env, contract_id.clone().into());

        let signer1 = create_address(&env, 1);
        let signer2 = create_address(&env, 2);

        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        client.initialize(&signers, &2);

        // Propose operation
        let operation_id: BytesN<32> = [0u8; 32].into();
        let action = Symbol::new(&env, "withdraw_fees");
        client.propose_operation(&operation_id, &action, &signer1);

        // Try to execute with only 1 approval (threshold is 2)
        client.execute_operation(&operation_id);
    }

    #[test]
    #[should_panic(expected = "operation already executed")]
    fn test_double_execution() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_test_contract_v2([], 0);
        let client = MultiSigAccessControl::new(&env, contract_id.clone().into());

        let signer1 = create_address(&env, 1);
        let signer2 = create_address(&env, 2);

        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        client.initialize(&signers, &2);

        // Propose and approve operation
        let operation_id: BytesN<32> = [0u8; 32].into();
        let action = Symbol::new(&env, "withdraw_fees");
        client.propose_operation(&operation_id, &action, &signer1);
        client.approve_operation(&operation_id, &signer2);

        // Execute first time
        client.execute_operation(&operation_id);

        // Try to execute again
        client.execute_operation(&operation_id);
    }

    #[test]
    #[should_panic(expected = "proposer is not an authorized signer")]
    fn test_propose_with_non_signer() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_test_contract_v2([], 0);
        let client = MultiSigAccessControl::new(&env, contract_id.clone().into());

        let signer1 = create_address(&env, 1);
        let non_signer = create_address(&env, 100);

        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());

        client.initialize(&signers, &1);

        // Try to propose with non-signer
        let operation_id: BytesN<32> = [0u8; 32].into();
        let action = Symbol::new(&env, "withdraw_fees");
        client.propose_operation(&operation_id, &action, &non_signer);
    }

    #[test]
    fn test_three_of_five_signers() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_test_contract_v2([], 0);
        let client = MultiSigAccessControl::new(&env, contract_id.clone().into());

        let signer1 = create_address(&env, 1);
        let signer2 = create_address(&env, 2);
        let signer3 = create_address(&env, 3);
        let signer4 = create_address(&env, 4);
        let signer5 = create_address(&env, 5);

        let mut signers = Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());
        signers.push_back(signer3.clone());
        signers.push_back(signer4.clone());
        signers.push_back(signer5.clone());

        // Require 3 of 5 signers
        client.initialize(&signers, &3);

        // Propose operation
        let operation_id: BytesN<32> = [0u8; 32].into();
        let action = Symbol::new(&env, "withdraw_fees");
        client.propose_operation(&operation_id, &action, &signer1);

        // Approve with signer2
        client.approve_operation(&operation_id, &signer2);

        // Should still fail - only 2 approvals
        let approval_count = client.get_approval_count(&operation_id);
        assert_eq!(approval_count, 2);

        // Approve with signer3 - now we have 3
        client.approve_operation(&operation_id, &signer3);

        // Now execution should succeed
        let result = client.execute_operation(&operation_id);
        assert!(result);
    }
}