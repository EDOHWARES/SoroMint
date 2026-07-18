import re

def main():
    with open('tests/utils/logger.test.js', 'r', encoding='utf-8') as f:
        lines = f.read().split('\n')

    open_braces = 0
    in_logger_describe = False
    
    for i, line in enumerate(lines):
        if "describe('Logger Utility'" in line:
            in_logger_describe = True
            
        open_braces += line.count('{')
        open_braces -= line.count('}')
        
        if in_logger_describe and open_braces == 0:
            print(f"Logger Utility closed at line {i+1}: {line}")
            break

if __name__ == '__main__':
    main()
