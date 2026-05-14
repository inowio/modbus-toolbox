import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FiBookOpen, FiList, FiSearch, FiX } from "react-icons/fi";
import { BiSolidArrowToTop } from "react-icons/bi";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_HELP_SECTION,
  HelpSectionDefinition,
  HelpSectionSlug,
  OpenHelpOptions,
  getHelpAnchorDomId,
  isHelpSectionSlug,
} from "./types";
import { getHelpSectionDefinitions } from "./helpSections";

export type HelpContextValue = {
  openHelp: (options?: OpenHelpOptions) => void;
  closeHelp: () => void;
  setHelpSection: (section: HelpSectionSlug, anchor?: string | null) => void;
  isHelpOpen: boolean;
  activeSection: HelpSectionSlug;
};

const HelpContext = createContext<HelpContextValue | null>(null);

type HelpProviderProps = {
  children: React.ReactNode;
};

type HelpSearchResult =
  | { kind: "section"; section: HelpSectionDefinition }
  | { kind: "anchor"; section: HelpSectionDefinition; anchorId: string; anchorLabel: string };

export function HelpProvider({ children }: HelpProviderProps) {
  const sections = useMemo(() => getHelpSectionDefinitions(), []);
  const sectionsBySlug = useMemo(() => {
    const map: Partial<Record<HelpSectionSlug, HelpSectionDefinition>> = {};
    for (const section of sections) {
      map[section.slug] = section;
    }
    return map as Record<HelpSectionSlug, HelpSectionDefinition>;
  }, [sections]);

  const [searchParams, setSearchParams] = useSearchParams();
  const helpParam = searchParams.get("help");
  const anchorParam = searchParams.get("helpAnchor");

  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<HelpSectionSlug>(DEFAULT_HELP_SECTION);
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<HelpSectionSlug | null>(null);
  const [pendingAnchorScroll, setPendingAnchorScroll] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (helpParam && isHelpSectionSlug(helpParam)) {
      setIsOpen(true);
      setActiveSection(helpParam);
      if (anchorParam) {
        setActiveAnchor(anchorParam);
        setPendingAnchorScroll(anchorParam);
      } else {
        setActiveAnchor(null);
        setPendingAnchorScroll(null);
      }
    } else {
      setIsOpen(false);
      setActiveAnchor(null);
      setPendingAnchorScroll(null);
    }
  }, [helpParam, anchorParam]);

  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      lastFocusedElementRef.current = document.activeElement as HTMLElement | null;
      setSearchQuery("");
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }

    if (!isOpen && prevOpenRef.current) {
      const last = lastFocusedElementRef.current;
      if (last) {
        last.focus({ preventScroll: true });
      }
    }

    prevOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !pendingAnchorScroll) return;

    const handle = window.setTimeout(() => {
      const id = getHelpAnchorDomId(activeSection, pendingAnchorScroll);
      const container = contentScrollRef.current;
      if (!container) {
        const el = document.getElementById(id);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        setPendingAnchorScroll(null);
        return;
      }

      const el = container.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setPendingAnchorScroll(null);
      }
    }, 100);

    return () => window.clearTimeout(handle);
  }, [activeSection, isOpen, pendingAnchorScroll]);

  const setUrlHelpState = useCallback(
    (section: HelpSectionSlug, anchor?: string | null, options?: { replace?: boolean }) => {
      const next = new URLSearchParams(searchParams);
      next.set("help", section);
      if (anchor) {
        next.set("helpAnchor", anchor);
      } else {
        next.delete("helpAnchor");
      }
      setSearchParams(next, { replace: options?.replace ?? false });
    },
    [searchParams, setSearchParams],
  );

  const closeHelp = useCallback(() => {
    if (!isOpen) return;
    const next = new URLSearchParams(searchParams);
    next.delete("help");
    next.delete("helpAnchor");
    setSearchParams(next, { replace: true });
  }, [isOpen, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeHelp();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeHelp, isOpen]);

  const openHelp = useCallback(
    (options: OpenHelpOptions = {}) => {
      const targetSection = options.section ?? (isHelpSectionSlug(helpParam) ? helpParam : activeSection);
      setUrlHelpState(targetSection, options.anchor ?? null, { replace: false });
    },
    [activeSection, helpParam, setUrlHelpState],
  );

  const setHelpSection = useCallback(
    (section: HelpSectionSlug, anchor?: string | null) => {
      setUrlHelpState(section, anchor ?? null, { replace: true });
    },
    [setUrlHelpState],
  );

  const activeDefinition = sectionsBySlug[activeSection] ?? sections[0];

  return (
    <HelpContext.Provider value={{ openHelp, closeHelp, setHelpSection, isHelpOpen: isOpen, activeSection }}>
      {children}
      <HelpModal
        open={isOpen}
        onClose={closeHelp}
        sections={sections}
        activeSection={activeDefinition}
        activeSectionSlug={activeDefinition.slug}
        activeAnchor={activeAnchor}
        expandedSection={expandedSection}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchInputRef={searchInputRef}
        contentScrollRef={contentScrollRef}
        setHelpSection={setHelpSection}
        setExpandedSection={setExpandedSection}
      />
    </HelpContext.Provider>
  );
}

export function useHelp(): HelpContextValue {
  const ctx = useContext(HelpContext);
  if (!ctx) {
    throw new Error("useHelp must be used within HelpProvider");
  }
  return ctx;
}

type HelpModalProps = {
  open: boolean;
  onClose: () => void;
  sections: HelpSectionDefinition[];
  activeSection: HelpSectionDefinition;
  activeSectionSlug: HelpSectionSlug;
  activeAnchor: string | null;
  expandedSection: HelpSectionSlug | null;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  contentScrollRef: React.RefObject<HTMLDivElement | null>;
  setHelpSection: (section: HelpSectionSlug, anchor?: string | null) => void;
  setExpandedSection: (section: HelpSectionSlug | null) => void;
};

function HelpModal(props: HelpModalProps) {
  const {
    open,
    onClose,
    sections,
    activeSection,
    activeSectionSlug,
    activeAnchor,
    expandedSection,
    searchQuery,
    onSearchQueryChange,
    searchInputRef,
    contentScrollRef,
    setHelpSection,
    setExpandedSection,
  } = props;

  const searchTerm = searchQuery.trim().toLowerCase();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const searchResults = useMemo<HelpSearchResult[]>(() => {
    if (!searchTerm) return [];
    const sectionHits = new Set<HelpSectionSlug>();
    const results: HelpSearchResult[] = [];

    for (const section of sections) {
      const corpus = [
        section.title,
        section.description,
        section.keywords.join(" "),
        section.searchText,
      ]
        .join(" ")
        .toLowerCase();

      if (corpus.includes(searchTerm) && !sectionHits.has(section.slug)) {
        sectionHits.add(section.slug);
        results.push({ kind: "section", section });
      }

      for (const anchor of section.anchors) {
        const anchorText = `${anchor.label} ${anchor.description ?? ""}`.toLowerCase();
        if (anchorText.includes(searchTerm)) {
          results.push({
            kind: "anchor",
            section,
            anchorId: anchor.id,
            anchorLabel: anchor.label,
          });
        }
      }
    }

    return results;
  }, [searchTerm, sections]);

  useEffect(() => {
    if (!open) return;
    const container = contentScrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      setShowScrollTop(container.scrollTop > 200);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener("scroll", handleScroll);
  }, [contentScrollRef, open]);

  if (!open) return null;

  const handleNavigate = (section: HelpSectionSlug, anchor?: string | null, afterNavigate?: () => void) => {
    // Toggle collapse if clicking the same section
    if (section === expandedSection && !anchor) {
      setExpandedSection(null);
    } else {
      setExpandedSection(section);
      setHelpSection(section, anchor ?? null);

      if (!anchor) {
        const container = contentScrollRef.current;
        if (container) {
          container.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
    }
    if (afterNavigate) {
      afterNavigate();
    }
  };

  const renderNavContent = (afterNavigate?: () => void) => (
    <>
      <label className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm shadow-black/5 focus-within:border-emerald-600/60 focus-within:ring-1 focus-within:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:shadow-black/0 dark:focus-within:border-emerald-500/60 dark:focus-within:ring-emerald-500/30">
        <FiSearch className="h-3.5 w-3.5" aria-hidden="true" />
        <input
          ref={afterNavigate ? undefined : searchInputRef}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.currentTarget.value)}
          placeholder="Search help"
          className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden dark:text-slate-100 dark:placeholder:text-slate-500"
          type="search"
        />
      </label>

      {searchTerm ? (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Search results</div>
          {searchResults.length === 0 ? (
            <div className="text-xs text-slate-500">No matches</div>
          ) : (
            <ul className="space-y-2">
              {searchResults.map((result, idx) => {
                if (result.kind === "section") {
                  return (
                    <li key={`section-${result.section.slug}-${idx}`}>
                      <button
                        type="button"
                        className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                          result.section.slug === activeSectionSlug
                            ? "border-emerald-600/60 bg-emerald-500/10 text-emerald-900 dark:border-emerald-500/60 dark:text-emerald-100"
                            : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 dark:border-slate-800 dark:bg-white/5 dark:text-slate-200 dark:hover:border-slate-700"
                        }`}
                        onClick={() => handleNavigate(result.section.slug, null, afterNavigate)}
                      >
                        {result.section.title}
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={`anchor-${result.section.slug}-${result.anchorId}-${idx}`}>
                    <button
                      type="button"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 transition hover:border-emerald-500/40 dark:border-slate-800 dark:bg-white/5 dark:text-slate-200"
                      onClick={() => handleNavigate(result.section.slug, result.anchorId, afterNavigate)}
                    >
                      <div className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{result.section.title}</div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{result.anchorLabel}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <nav className="mt-4 space-y-3">
          {sections.map((section) => (
            <div key={section.slug} className="space-y-1">
              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                  section.slug === activeSectionSlug
                    ? "border-emerald-600/60 bg-emerald-500/10 text-emerald-900 dark:border-emerald-500/60 dark:text-emerald-100"
                    : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 dark:border-slate-800 dark:bg-white/5 dark:text-slate-200 dark:hover:border-slate-700"
                }`}
                onClick={() => handleNavigate(section.slug, null, afterNavigate)}
              >
                {section.title}
                <span className="text-[11px] uppercase tracking-wide text-slate-500">{section.anchors.length} topics</span>
              </button>
              {section.slug === expandedSection ? (
                <ul className="ml-2 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-800">
                  {section.anchors.map((anchor) => (
                    <li key={anchor.id}>
                      <button
                        type="button"
                        className={`w-full rounded-lg px-2 py-1 text-left text-xs transition ${
                          anchor.id === activeAnchor
                            ? "bg-emerald-500/10 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-100"
                            : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                        }`}
                        onClick={() => handleNavigate(section.slug, anchor.id, afterNavigate)}
                      >
                        {anchor.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </nav>
      )}
    </>
  );

  return createPortal(
    <div className="fixed inset-0 z-70 flex bg-white/95 text-slate-900 backdrop-blur-sm dark:bg-slate-950/95 dark:text-slate-100">
      <div className="flex min-h-0 w-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-emerald-600/40 bg-emerald-500/10 p-2 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300">
              <FiBookOpen className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <div className="text-xs uppercase font-semibold  dark:font-normal tracking-[0.35em] text-emerald-700 dark:text-emerald-300">Help</div>
              <div className="text-sm text-slate-600 dark:text-slate-300">Modbus Toolbox</div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
            onClick={onClose}
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="hidden w-full max-h-[55vh] overflow-y-auto border-b border-slate-200 bg-slate-50/70 p-4 lg:block lg:w-80 lg:max-h-[calc(100vh-120px)] lg:border-b-0 lg:border-r lg:overflow-y-auto lg:min-h-0 dark:border-slate-800/80 dark:bg-slate-950/40">
            {renderNavContent()}
          </aside>

          <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8" ref={contentScrollRef}>
            <div className="mb-4 flex items-center justify-between gap-2 lg:hidden">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{activeSection.title}</div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-500/60 hover:text-emerald-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:text-emerald-100"
                onClick={() => setMobileNavOpen(true)}
              >
                <FiList className="h-3 w-3" aria-hidden="true" />
                Topics
              </button>
            </div>
            <div className="w-full space-y-6">
              {React.createElement(activeSection.Component)}
            </div>
          </main>
        </div>
      </div>

      {showScrollTop ? (
        <div className="lg:hidden fixed bottom-20 right-4 z-85 flex flex-col items-center gap-1 text-emerald-700 dark:text-emerald-100">
          <button
            type="button"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-emerald-600/40 bg-emerald-500/10 text-emerald-800 shadow-lg shadow-black/10 backdrop-blur-sm transition hover:border-emerald-500 dark:border-emerald-500/60 dark:bg-emerald-500/25 dark:text-emerald-100 dark:shadow-black/40 dark:hover:border-emerald-400"
            onClick={() => {
              const container = contentScrollRef.current;
              if (container) {
                container.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            aria-label="Scroll to top"
            title="Scroll to top"
          >
            <BiSolidArrowToTop className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {mobileNavOpen ? (
        <div className="lg:hidden fixed inset-0 z-80 flex flex-col bg-white/95 text-slate-900 backdrop-blur-sm dark:bg-slate-950/95 dark:text-slate-100">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div>
              <div className="text-xs uppercase font-semibold  dark:font-normal tracking-[0.35em] text-emerald-700 dark:text-emerald-300">Help topics</div>
              <div className="text-sm text-slate-600 dark:text-slate-300">Search & jump to sections</div>
            </div>
            <button
              type="button"
              className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
              onClick={() => setMobileNavOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {renderNavContent(() => setMobileNavOpen(false))}
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
