import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Plus,
  Tag,
  Link,
  Loader2,
  ChevronRight,
  Clock,
  FileText,
  Hash,
  Trash2,
  AlertCircle,
  Vote,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { createProposal } from '../services/votingService';

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Format a Date object as the string value required by <input type="datetime-local">.
 * Result format: "YYYY-MM-DDTHH:MM"
 */
const toDatetimeLocal = (date) => {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
};

const getDefaultStartTime = () => toDatetimeLocal(Date.now() + 86_400_000);          // +1 day
const getDefaultEndTime   = () => toDatetimeLocal(Date.now() + 8 * 86_400_000);       // +8 days

// ─── Initial state factory ────────────────────────────────────────────────────

const makeInitialForm = () => ({
  title:         '',
  description:   '',
  choices:       ['Yes', 'No'],
  startTime:     getDefaultStartTime(),
  endTime:       getDefaultEndTime(),
  tags:          '',
  discussionUrl: '',
  contractId:    '',
});

// ─── Validation ───────────────────────────────────────────────────────────────

const validate = (form) => {
  const errors = {};

  if (!form.title.trim()) {
    errors.title = 'Title is required.';
  } else if (form.title.trim().length > 200) {
    errors.title = 'Title must be 200 characters or fewer.';
  }

  if (!form.description.trim()) {
    errors.description = 'Description is required.';
  } else if (form.description.trim().length > 5000) {
    errors.description = 'Description must be 5 000 characters or fewer.';
  }

  const validChoices = form.choices.filter((c) => c.trim().length > 0);
  if (validChoices.length < 2) {
    errors.choices = 'At least 2 non-empty choices are required.';
  }

  if (!form.startTime) {
    errors.startTime = 'Start time is required.';
  }

  if (!form.endTime) {
    errors.endTime = 'End time is required.';
  } else if (form.startTime && new Date(form.endTime) <= new Date(form.startTime)) {
    errors.endTime = 'End time must be after start time.';
  }

  if (form.discussionUrl.trim() && !/^https?:\/\/.+/.test(form.discussionUrl.trim())) {
    errors.discussionUrl = 'Must be a valid http(s) URL.';
  }

  return errors;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldLabel({ children, htmlFor, required = false, hint }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"
    >
      {children}
      {required && <span className="text-red-400" aria-hidden="true">*</span>}
      {hint && (
        <span className="ml-1 text-xs font-normal text-slate-400 dark:text-slate-500">
          {hint}
        </span>
      )}
    </label>
  );
}

function FieldError({ message }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500 dark:text-red-400">
      <AlertCircle size={12} className="shrink-0" />
      {message}
    </p>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CreateProposalModal({ open, onClose, token, onCreated }) {
  const [form, setForm]           = useState(makeInitialForm);
  const [errors, setErrors]       = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched]     = useState({});

  // Reset form whenever the modal is (re-)opened.
  useEffect(() => {
    if (open) {
      setForm(makeInitialForm());
      setErrors({});
      setTouched({});
      setIsSubmitting(false);
    }
  }, [open]);

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── Field helpers ──────────────────────────────────────────────────────────

  const setField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear that field's error once the user starts editing.
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const markTouched = useCallback((key) => {
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  // ── Choice list helpers ────────────────────────────────────────────────────

  const setChoice = (idx, value) => {
    const updated = [...form.choices];
    updated[idx] = value;
    setField('choices', updated);
  };

  const addChoice = () => {
    if (form.choices.length >= 10) return;
    setField('choices', [...form.choices, '']);
  };

  const removeChoice = (idx) => {
    if (form.choices.length <= 2) return;
    setField('choices', form.choices.filter((_, i) => i !== idx));
  };

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Mark every field touched so all errors show.
    setTouched({
      title: true, description: true, choices: true,
      startTime: true, endTime: true, discussionUrl: true,
    });

    const errs = validate(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        title:       form.title.trim(),
        description: form.description.trim(),
        choices:     form.choices.map((c) => c.trim()).filter(Boolean),
        startTime:   new Date(form.startTime).toISOString(),
        endTime:     new Date(form.endTime).toISOString(),
      };

      if (form.tags.trim()) {
        payload.tags = form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 10);
      }
      if (form.discussionUrl.trim()) payload.discussionUrl = form.discussionUrl.trim();
      if (form.contractId.trim())    payload.contractId    = form.contractId.trim();

      const created = await createProposal(payload, token);
      toast.success('Proposal created successfully! 🎉');
      onCreated(created);
      onClose();
    } catch (err) {
      toast.error(`Failed to create proposal: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Backdrop click ─────────────────────────────────────────────────────────

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !isSubmitting) onClose();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!open) return null;

  const charCount = (str, max) => (
    <span
      className={`tabular-nums text-xs ${
        str.length > max * 0.9
          ? str.length >= max
            ? 'text-red-400'
            : 'text-amber-400'
          : 'text-slate-400 dark:text-slate-500'
      }`}
    >
      {str.length}/{max}
    </span>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-proposal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      {/* ── Modal card ─────────────────────────────────────────────────────── */}
      <div className="flex w-full max-w-2xl flex-col max-h-[92vh] rounded-3xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">

        {/* ── Sticky header ──────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 dark:border-white/10 px-6 py-4 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-stellar-blue/10 p-2">
              <Vote size={16} className="text-stellar-blue" />
            </div>
            <h2
              id="create-proposal-title"
              className="text-lg font-semibold text-slate-900 dark:text-white"
            >
              New Governance Proposal
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close modal"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-black/5 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-white disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="space-y-6 px-6 py-6">

            {/* ── Title ──────────────────────────────────────────────────── */}
            <div>
              <div className="flex items-end justify-between">
                <FieldLabel htmlFor="cp-title" required>
                  <FileText size={14} />
                  Title
                </FieldLabel>
                {touched.title && charCount(form.title, 200)}
              </div>
              <input
                id="cp-title"
                type="text"
                placeholder="e.g. Upgrade protocol treasury fee to 0.5%"
                maxLength={200}
                className={`input-field w-full ${
                  errors.title ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''
                }`}
                value={form.title}
                onChange={(e) => setField('title', e.target.value)}
                onBlur={() => markTouched('title')}
              />
              <FieldError message={errors.title} />
            </div>

            {/* ── Description ────────────────────────────────────────────── */}
            <div>
              <div className="flex items-end justify-between">
                <FieldLabel htmlFor="cp-description" required>
                  <Hash size={14} />
                  Description
                </FieldLabel>
                {touched.description && charCount(form.description, 5000)}
              </div>
              <textarea
                id="cp-description"
                placeholder="Describe the motivation, context, and expected outcome of this proposal..."
                maxLength={5000}
                rows={4}
                className={`input-field w-full resize-y min-h-[96px] ${
                  errors.description ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''
                }`}
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                onBlur={() => markTouched('description')}
              />
              <FieldError message={errors.description} />
            </div>

            {/* ── Voting choices ─────────────────────────────────────────── */}
            <div>
              <FieldLabel required hint={`(${form.choices.length} / 10 max)`}>
                <Vote size={14} />
                Voting Choices
              </FieldLabel>

              <div className="space-y-2">
                {form.choices.map((choice, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {/* Index pill */}
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 dark:bg-white/10 text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                      {idx + 1}
                    </span>

                    <input
                      type="text"
                      placeholder={`Choice ${idx + 1}`}
                      maxLength={100}
                      className={`input-field flex-1 py-2.5 ${
                        errors.choices && !choice.trim()
                          ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20'
                          : ''
                      }`}
                      value={choice}
                      onChange={(e) => setChoice(idx, e.target.value)}
                      onBlur={() => markTouched('choices')}
                    />

                    <button
                      type="button"
                      onClick={() => removeChoice(idx)}
                      disabled={form.choices.length <= 2}
                      aria-label={`Remove choice ${idx + 1}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-25"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <FieldError message={errors.choices} />

              {form.choices.length < 10 && (
                <button
                  type="button"
                  onClick={addChoice}
                  className="mt-2.5 flex items-center gap-1.5 text-sm font-medium text-stellar-blue transition-colors hover:text-blue-600"
                >
                  <Plus size={15} />
                  Add Choice
                </button>
              )}
            </div>

            {/* ── Voting window ──────────────────────────────────────────── */}
            <div>
              <FieldLabel required>
                <Clock size={14} />
                Voting Window
              </FieldLabel>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                    Start Time
                  </label>
                  <input
                    id="cp-start-time"
                    type="datetime-local"
                    className={`input-field w-full ${
                      errors.startTime ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''
                    }`}
                    value={form.startTime}
                    onChange={(e) => setField('startTime', e.target.value)}
                    onBlur={() => markTouched('startTime')}
                  />
                  <FieldError message={errors.startTime} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                    End Time
                  </label>
                  <input
                    id="cp-end-time"
                    type="datetime-local"
                    className={`input-field w-full ${
                      errors.endTime ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''
                    }`}
                    value={form.endTime}
                    onChange={(e) => setField('endTime', e.target.value)}
                    onBlur={() => markTouched('endTime')}
                  />
                  <FieldError message={errors.endTime} />
                </div>
              </div>
            </div>

            {/* ── Optional section divider ───────────────────────────────── */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-black/5 dark:border-white/10" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white dark:bg-slate-900 px-3 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  Optional
                </span>
              </div>
            </div>

            {/* ── Tags ───────────────────────────────────────────────────── */}
            <div>
              <FieldLabel htmlFor="cp-tags" hint="(comma-separated, up to 10)">
                <Tag size={14} />
                Tags
              </FieldLabel>
              <input
                id="cp-tags"
                type="text"
                placeholder="treasury, upgrade, community, security…"
                className="input-field w-full"
                value={form.tags}
                onChange={(e) => setField('tags', e.target.value)}
              />
              {/* Tag preview */}
              {form.tags.trim() ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {form.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 10)
                    .map((tag, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-black/5 dark:border-white/10 bg-black/5 dark:bg-white/5 px-2 py-0.5 text-[11px] text-slate-500 dark:text-slate-400"
                      >
                        {tag}
                      </span>
                    ))}
                </div>
              ) : null}
            </div>

            {/* ── Discussion URL ─────────────────────────────────────────── */}
            <div>
              <FieldLabel htmlFor="cp-discussion-url">
                <Link size={14} />
                Discussion URL
              </FieldLabel>
              <input
                id="cp-discussion-url"
                type="url"
                placeholder="https://forum.soromint.io/proposals/…"
                className={`input-field w-full ${
                  errors.discussionUrl ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''
                }`}
                value={form.discussionUrl}
                onChange={(e) => setField('discussionUrl', e.target.value)}
                onBlur={() => markTouched('discussionUrl')}
              />
              <FieldError message={errors.discussionUrl} />
            </div>

            {/* ── Token scope / Contract ID ──────────────────────────────── */}
            <div>
              <FieldLabel htmlFor="cp-contract-id">
                Token Scope
              </FieldLabel>
              <input
                id="cp-contract-id"
                type="text"
                placeholder="C… (Stellar contract address)"
                className="input-field w-full font-mono text-sm tracking-tight"
                value={form.contractId}
                onChange={(e) => setField('contractId', e.target.value)}
              />
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                Restrict voting power to holders of a specific Stellar token contract.
                Leave blank to use global voting power.
              </p>
            </div>

          </div>{/* /space-y-6 */}

          {/* ── Sticky footer ───────────────────────────────────────────── */}
          <div className="sticky bottom-0 flex shrink-0 items-center justify-end gap-3 border-t border-black/5 dark:border-white/10 bg-white dark:bg-slate-900 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-xl border border-black/10 dark:border-white/10 px-5 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:border-black/20 dark:hover:border-white/20 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  Create Proposal
                  <ChevronRight size={16} />
                </>
              )}
            </button>
          </div>

        </form>{/* /form */}
      </div>
    </div>
  );
}
