import urllib.request
import urllib.parse
import json
import time

TOKEN = "ghp_REMOVED_FOR_SECURITY"
REPO = "EDOHWARES/SoroMint"

def get_issues(page=1):
    url = f"https://api.github.com/repos/{REPO}/issues?state=open&per_page=100&page={page}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"token {TOKEN}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("User-Agent", "SoroMint-Issue-Cleaner")
    
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching issues: {e}")
        return []

def close_issue(number):
    url = f"https://api.github.com/repos/{REPO}/issues/{number}"
    data = json.dumps({"state": "closed"}).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='PATCH')
    req.add_header("Authorization", f"token {TOKEN}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("User-Agent", "SoroMint-Issue-Cleaner")
    req.add_header("Content-Type", "application/json")
    
    try:
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                print(f"✅ Closed duplicate issue #{number}", flush=True)
    except Exception as e:
        print(f"❌ Error closing issue #{number}: {e}", flush=True)

def main():
    all_issues = []
    # Fetch first 3 pages (up to 300 issues)
    for page in range(1, 4):
        issues = get_issues(page)
        if not issues:
            break
        all_issues.extend(issues)
        print(f"Fetched {len(issues)} issues from page {page}...", flush=True)

    print(f"Total issues fetched: {len(all_issues)}")
    
    seen_titles = set()
    duplicates_to_close = []
    
    for issue in all_issues:
        title = issue['title']
        number = issue['number']
        
        if title in seen_titles:
            duplicates_to_close.append(number)
        else:
            seen_titles.add(title)
    
    print(f"Found {len(duplicates_to_close)} duplicates to close.", flush=True)
    
    for number in duplicates_to_close:
        close_issue(number)
        time.sleep(0.5) # Fast cleanup

if __name__ == "__main__":
    main()
