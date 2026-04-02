import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import {
  BookOpenText,
  ChevronRight,
  FileCode2,
  FlaskConical,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'
import { developerDocuments } from '../content/developer-documents'

const API_DOCS_URL = 'http://localhost:5000/api-docs'
const HEALTH_URL = 'http://localhost:5000/api/health'

const categoryIcons = {
  'Core API': FileCode2,
  Security: ShieldCheck,
  Operations: TerminalSquare,
  'Contributor Guide': FlaskConical,
}

function QuickLinkCard({ href, title, caption, value }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="hub-link-card"
    >
      <div>
        <p className="hub-link-label">{title}</p>
        <p className="hub-link-caption">{caption}</p>
      </div>
      <div className="hub-link-value">{value}</div>
    </a>
  )
}

export default function DeveloperHub() {
  const [activeDocumentId, setActiveDocumentId] = useState(developerDocuments[0].id)

  const activeDocument = useMemo(
    () => developerDocuments.find((document) => document.id === activeDocumentId) ?? developerDocuments[0],
    [activeDocumentId],
  )

  const groupedDocuments = useMemo(() => {
    return developerDocuments.reduce((groups, document) => {
      if (!groups[document.category]) {
        groups[document.category] = []
      }

      groups[document.category].push(document)
      return groups
    }, {})
  }, [])

  const snippetCount = developerDocuments.filter((document) => document.markdown.includes('```')).length

  return (
    <section className="space-y-8">
      <div className="glass-card hub-hero">
        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.95fr]">
          <div className="space-y-5">
            <div className="hub-kicker">
              <BookOpenText className="h-4 w-4" />
              Developer Hub
            </div>
            <div className="space-y-3">
              <h2 className="text-4xl font-bold tracking-tight text-white">
                Build against SoroMint without leaving the UI.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-slate-300">
                Browse the API surface, auth flow, validation rules, and contributor guidance
                from a dedicated documentation workspace built into the app.
              </p>
            </div>
            <div className="hub-stat-grid">
              <div className="hub-stat-card">
                <span className="hub-stat-value">{developerDocuments.length}</span>
                <span className="hub-stat-label">Docs loaded</span>
              </div>
              <div className="hub-stat-card">
                <span className="hub-stat-value">{snippetCount}</span>
                <span className="hub-stat-label">Code examples</span>
              </div>
              <div className="hub-stat-card">
                <span className="hub-stat-value">Live</span>
                <span className="hub-stat-label">API references</span>
              </div>
            </div>
          </div>

          <div className="hub-quick-links">
            <QuickLinkCard
              href={API_DOCS_URL}
              title="Swagger UI"
              caption="Interactive request explorer"
              value="/api-docs"
            />
            <QuickLinkCard
              href={HEALTH_URL}
              title="Health Check"
              caption="Verify service readiness"
              value="GET /api/health"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="glass-card hub-nav lg:sticky lg:top-6 lg:self-start">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-200/80">
              Documentation
            </p>
            <h3 className="mt-3 text-2xl font-semibold text-white">Sections</h3>
          </div>

          <div className="space-y-6">
            {Object.entries(groupedDocuments).map(([category, documents]) => {
              const CategoryIcon = categoryIcons[category] ?? BookOpenText

              return (
                <div key={category} className="space-y-3">
                  <div className="hub-category-heading">
                    <CategoryIcon className="h-4 w-4" />
                    <span>{category}</span>
                  </div>
                  <div className="space-y-2">
                    {documents.map((document) => {
                      const isActive = document.id === activeDocument.id

                      return (
                        <button
                          key={document.id}
                          type="button"
                          onClick={() => setActiveDocumentId(document.id)}
                          className={`hub-nav-button ${isActive ? 'hub-nav-button-active' : ''}`}
                        >
                          <div>
                            <p className="hub-nav-title">{document.title}</p>
                            <p className="hub-nav-summary">{document.summary}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        <article className="glass-card hub-document">
          <div className="hub-document-header">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="hub-badge">{activeDocument.category}</span>
                <span className="hub-source">{activeDocument.source}</span>
              </div>
              <div className="space-y-2">
                <h3 className="text-3xl font-semibold tracking-tight text-white">
                  {activeDocument.title}
                </h3>
                <p className="max-w-3xl text-base leading-7 text-slate-300">
                  {activeDocument.summary}
                </p>
              </div>
            </div>
          </div>

          <div className="doc-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
            >
              {activeDocument.markdown}
            </ReactMarkdown>
          </div>
        </article>
      </div>
    </section>
  )
}
