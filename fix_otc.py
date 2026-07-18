import sys

content = open('contracts/otc_escrow/src/test.rs').read()
content = content.replace("fn create_token_contract<'a>(e: &Env, admin: &Address) -> (Address, token::Client<'a>) {", "fn create_token_contract<'a>(e: &Env, admin: &Address) -> (Address, token::Client<'a>, token::StellarAssetClient<'a>) {")
content = content.replace("    (contract_id.clone(), token::Client::new(e, &contract_id))\n}", "    (contract_id.clone(), token::Client::new(e, &contract_id), token::StellarAssetClient::new(e, &contract_id))\n}")
content = content.replace("let (token_a_id, token_a) =", "let (token_a_id, token_a, token_a_admin) =")
content = content.replace("let (token_b_id, token_b) =", "let (token_b_id, token_b, token_b_admin) =")
content = content.replace("token_a.mint(", "token_a_admin.mint(")
content = content.replace("token_b.mint(", "token_b_admin.mint(")
open('contracts/otc_escrow/src/test.rs', 'w').write(content)
