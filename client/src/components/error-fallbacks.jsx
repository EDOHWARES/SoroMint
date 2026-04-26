import { AlertTriangle, RefreshCcw, ShieldAlert } from 'lucide-react'

function refreshPage() {
  window.location.reload()
}

export function AppCrashPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.25),_transparent_55%),linear-gradient(180deg,_rgba(15,23,42,1)_0%,_rgba(2,6,23,1)_100%)] px-6 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <div className="w-full rounded-[2rem] border border-white/10 bg-slate-950/70 p-8 shadow-2xl shadow-sky-950/40 backdrop-blur-xl sm:p-12">
          <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-red-300 ring-1 ring-red-400/20">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.35em] text-red-200/80">
            Oops
          </p>
          <h1 className="mb-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            The app hit an unexpected problem.
          </h1>
          <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            We caught the crash before it turned into a blank screen. Refresh the
            page to restart the interface and try again.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={refreshPage}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-3 font-semibold text-white transition hover:bg-sky-400"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh page
            </button>
            <p className="self-center text-sm text-slate-400">
              If this keeps happening, check the browser console for the captured error.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SectionCrashCard({
  className = '',
  title,
  description,
  onRetry,
}) {
  return (
    <div className={`glass-card min-h-[400px] border-red-400/20 bg-red-500/5 ${className}`.trim()}>
      <div className="flex h-full flex-col items-start justify-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-300 ring-1 ring-red-400/20">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <p className="max-w-md text-sm leading-6 text-slate-300">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 font-medium text-white transition hover:bg-white/10"
          >
            <RefreshCcw className="h-4 w-4" />
            Try again
          </button>
          <button
            type="button"
            onClick={refreshPage}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 font-semibold text-white transition hover:bg-sky-400"
          >
            Refresh page
          </button>
        </div>
      </div>
    </div>
  )
}
