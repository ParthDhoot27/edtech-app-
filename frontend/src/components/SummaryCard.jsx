import { useEffect, useState } from "react";
import SectionBlock from "./SectionBlock";

function SummaryCard({ summary }) {
  const overviewParagraphs = Array.isArray(summary?.overview_paragraphs) ? summary.overview_paragraphs : [];
  const fullOverviewLength = overviewParagraphs.reduce((length, paragraph) => length + paragraph.length + 1, 0);
  const [visibleCharacters, setVisibleCharacters] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVisibleCharacters(fullOverviewLength);
      return undefined;
    }

    setVisibleCharacters(0);
    if (!fullOverviewLength) return undefined;

    const intervalId = window.setInterval(() => {
      setVisibleCharacters((visible) => {
        const next = Math.min(visible + 16, fullOverviewLength);
        if (next === fullOverviewLength) window.clearInterval(intervalId);
        return next;
      });
    }, 25);

    return () => window.clearInterval(intervalId);
  }, [summary, fullOverviewLength]);

  return (
    <div className="card card-elevated space-y-6 p-6 sm:p-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-white">Structured Summary</h2>
        <p className="mt-1 text-sm text-slate-300">Detailed, source-grounded notes with explanations and exam-focused context.</p>
      </div>

      <section className="rounded-2xl border border-blue-400/25 bg-gradient-to-br from-blue-500/15 via-slate-900/45 to-cyan-500/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100/90">Detailed Topic Summary</p>
        {visibleCharacters < fullOverviewLength && (
          <p className="mt-2 text-xs text-blue-100/70" role="status">Writing your study summary...</p>
        )}
        <div className="mt-3 space-y-3 text-sm leading-7 text-slate-100/95">
          {overviewParagraphs.length ? (
            overviewParagraphs.map((paragraph, index) => {
              const start = overviewParagraphs
                .slice(0, index)
                .reduce((length, previous) => length + previous.length + 1, 0);
              const visibleLength = Math.max(0, Math.min(paragraph.length, visibleCharacters - start));
              if (!visibleLength) return null;

              return (
                <p key={`overview-${index}`} aria-live="off">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-300/45 text-[11px] font-semibold text-blue-100">
                    {index + 1}
                  </span>
                  <span className="sr-only">{paragraph}</span>
                  <span aria-hidden="true">
                    {paragraph.slice(0, visibleLength)}
                    {visibleLength < paragraph.length && <span className="animate-pulse">|</span>}
                  </span>
                </p>
              );
            })
          ) : (
            <p className="text-slate-300">No overview was returned for this source.</p>
          )}
        </div>
      </section>

      <div className="space-y-3">
        <SectionBlock title="Key Definitions" items={summary?.key_definitions} defaultOpen />
        <SectionBlock title="Core Concepts and Why They Matter" items={summary?.core_concepts} />
        <SectionBlock title="Examples and Their Applications" items={summary?.important_examples} />
        <SectionBlock title="Exam Revision Points" items={summary?.exam_revision_points} />
      </div>
    </div>
  );
}

export default SummaryCard;
