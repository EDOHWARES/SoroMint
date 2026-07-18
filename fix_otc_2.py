import sys

content = open('contracts/otc_escrow/src/test.rs').read()
content = content.replace("let (token_a_id, _) =", "let (token_a_id, _, _) =")
content = content.replace("let (token_b_id, _) =", "let (token_b_id, _, _) =")
open('contracts/otc_escrow/src/test.rs', 'w').write(content)
