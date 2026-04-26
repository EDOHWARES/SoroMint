import fs from 'node:fs';
import path from 'node:path';

// Manual .env loader (since we are not using a root package.json)
function loadEnv() {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
                process.env[key.trim()] = valueParts.join('=').trim();
            }
        });
    }
}

loadEnv();

// Configuration - Use environment variables for security
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.REPO_OWNER || 'EDOHWARES';
const REPO = process.env.REPO_NAME || 'SoroMint';

if (!TOKEN) {
    console.error("❌ Error: GH_TOKEN environment variable is not set.");
    console.log("👉 Please set it in your environment or a .env file.");
    process.exit(1);
}

/**
 * Creates a single issue on GitHub
 */
async function createIssue(title, body, labels) {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/issues`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `token ${TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'SoroMint-Issue-Creator'
            },
            body: JSON.stringify({ title, body, labels })
        });

        if (response.status === 201) {
            console.log(`✅ Created issue: ${title}`);
        } else {
            const errorData = await response.json();
            console.warn(`⚠️ Failed to create issue: ${title} (Status: ${response.status})`, errorData.message);
        }
    } catch (error) {
        console.error(`❌ Error creating issue '${title}':`, error.message);
    }
}

/**
 * Parses the markdown file into an array of issue objects
 */
function parseIssues(filename) {
    const filePath = path.resolve(filename);
    if (!fs.existsSync(filePath)) {
        console.error(`❌ Error: File ${filename} not found.`);
        return [];
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const issues = [];
    let currentIssue = null;

    for (const line of lines) {
        if (line.startsWith('# ')) {
            // Save previous issue
            if (currentIssue) issues.push(currentIssue);
            
            const title = line.replace('# ', '').trim();
            currentIssue = {
                title: title,
                body: '',
                labels: ['good-first-issue']
            };

            // Dynamic labeling logic
            if (title.includes('Smart Contract')) {
                currentIssue.labels.push('smart-contract');
            } else if (title.includes('Backend')) {
                currentIssue.labels.push('backend');
            } else if (title.includes('Frontend')) {
                currentIssue.labels.push('frontend');
            }
        } else if (currentIssue) {
            currentIssue.body += line + '\n';
        }
    }

    // Push the last issue
    if (currentIssue) issues.push(currentIssue);
    
    return issues;
}

/**
 * Main execution flow
 */
async function main() {
    console.log(`🚀 Starting issue creation for ${OWNER}/${REPO}...`);
    
    const issues = parseIssues('GITHUB_ISSUES_FORMATTED.md');
    
    if (issues.length === 0) {
        console.log("No issues found to create.");
        return;
    }
    
    for (const issue of issues) {
        await createIssue(issue.title, issue.body, issue.labels);
        // Delay to stay within GitHub rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log("🏁 Done!");
}

main().catch(err => console.error("💥 Fatal Error:", err));
