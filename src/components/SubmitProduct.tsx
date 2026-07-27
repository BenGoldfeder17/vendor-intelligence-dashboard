"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormField, NormalizedSchema, ProductTypeSummary } from "@/lib/productTypes";
import type { Submission, SubmissionStatus } from "@/lib/submissions";

interface SlimProduct {
  asin: string;
  style: string | null;
  style10: string | null;
  title: string | null;
  brand: string | null;
  productType: string | null;
  thumbnail: string | null;
}

type ImageMode = "public" | "proxy" | "off";

interface Status {
  kind: "ok" | "bad" | "busy" | "warn";
  text: string;
}

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  submitted: "Submitted",
  live: "Live",
};

const IMAGE_ORDER = [
  "main_product_image_locator",
  "other_product_image_locator_1",
  "other_product_image_locator_2",
  "other_product_image_locator_3",
  "other_product_image_locator_4",
  "other_product_image_locator_5",
  "other_product_image_locator_6",
  "other_product_image_locator_7",
  "other_product_image_locator_8",
  "swatch_product_image_locator",
];

const DEFAULT_TYPE = "PROTECTIVE_GLOVE";

export default function SubmitProduct() {
  const [catalog, setCatalog] = useState<SlimProduct[]>([]);
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);
  const [allTypes, setAllTypes] = useState<ProductTypeSummary[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [imageMode, setImageMode] = useState<ImageMode | null>(null);

  const [productType, setProductType] = useState(DEFAULT_TYPE);
  const [schema, setSchema] = useState<NormalizedSchema | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [sku, setSku] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [showAll, setShowAll] = useState(false);
  const [fieldFilter, setFieldFilter] = useState("");
  const [showPayload, setShowPayload] = useState(false);
  const [clonedFrom, setClonedFrom] = useState<string | null>(null);

  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneQuery, setCloneQuery] = useState("");

  const [subs, setSubs] = useState<Submission[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  /** Status is shown in a banner pinned under the masthead — never buried. */
  const say = useCallback((kind: Status["kind"], text: string) => setStatus({ kind, text }), []);

  const [amazonIssues, setAmazonIssues] = useState<
    { code: string; message: string; severity: string; attributeName?: string }[]
  >([]);


  const loadSubs = useCallback(async () => {
    const r = await fetch("/api/submissions");
    const j = (await r.json()) as { submissions?: Submission[] };
    setSubs(j.submissions ?? []);
  }, []);

  /** Push the saved draft to Amazon via the Listings Items API. */
  const submitToAmazon = useCallback(async () => {
    if (!editingId) {
      say("bad", "Save the draft before submitting.");
      return;
    }
    setAmazonIssues([]);
    setSaving(true);
    say("busy", "Submitting to Amazon…");
    const r = await fetch(`/api/submissions/${editingId}/submit`, { method: "POST" });
    const j = (await r.json()) as {
      ok?: boolean;
      error?: string;
      status?: string;
      issues?: { code: string; message: string; severity: string; attributeName?: string }[];
      errors?: string[];
      submission?: Submission;
    };
    setSaving(false);

    if (j.ok) {
      if (j.submission) setEditingId(j.submission.id);
      say(
        "ok",
        `Submitted to Amazon (${j.status}). It'll turn Live once the ASIN appears in a catalog sync.`
      );
      void loadSubs();
      return;
    }

    if (j.issues?.length) setAmazonIssues(j.issues);
    if (j.errors?.length) {
      say("bad", `Fix ${j.errors.length} field issue(s) before submitting.`);
    } else {
      say("bad", j.error ?? "Amazon rejected the submission.");
    }
  }, [editingId, say, loadSubs]);

  useEffect(() => {
    void loadSubs();

    void (async () => {
      const r = await fetch("/api/products");
      const j = (await r.json()) as {
        products?: SlimProduct[];
        meta?: { warnings?: string[] } | null;
      };
      setCatalog(j.products ?? []);
      // The sync records why catalog data is missing. Show it — it's the reason
      // clones come back thin and product types are blank.
      const w = (j.meta?.warnings ?? []).find(
        (x) => /product listing role|403/i.test(x) && /catalog/i.test(x)
      );
      setCatalogWarning(w ?? null);
    })();

    void (async () => {
      const r = await fetch("/api/images");
      const j = (await r.json()) as { mode?: ImageMode };
      setImageMode(j.mode ?? "off");
    })();

    // Every product type Amazon offers — not just gloves.
    void (async () => {
      setTypesLoading(true);
      const r = await fetch("/api/product-types");
      const j = (await r.json()) as { productTypes?: ProductTypeSummary[]; error?: string };
      if (j.error) say("bad", `Couldn't load product types: ${j.error}`);
      setAllTypes(j.productTypes ?? []);
      setTypesLoading(false);
    })();
  }, [loadSubs, say]);

  useEffect(() => {
    if (!productType) return;
    let cancelled = false;
    setLoadingSchema(true);
    setSchemaError(null);
    void (async () => {
      const r = await fetch(`/api/product-types/${encodeURIComponent(productType)}`);
      const j = (await r.json()) as NormalizedSchema & { error?: string };
      if (cancelled) return;
      if (j.error) {
        setSchemaError(j.error);
        setSchema(null);
      } else {
        setSchema(j);
      }
      setLoadingSchema(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [productType]);

  const catalogTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of catalog) {
      if (!p.productType) continue;
      counts.set(p.productType, (counts.get(p.productType) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [catalog]);

  const fields = schema?.fields ?? [];
  const editable = useMemo(() => fields.filter((f) => f.kind !== "unsupported"), [fields]);
  const unsupported = useMemo(() => fields.filter((f) => f.kind === "unsupported"), [fields]);
  const imageFields = useMemo(() => {
    const byName = new Map(editable.filter((f) => f.kind === "image").map((f) => [f.name, f]));
    return IMAGE_ORDER.map((n) => byName.get(n)).filter((f): f is FormField => Boolean(f));
  }, [editable]);

  const visible = useMemo(() => {
    const q = fieldFilter.trim().toLowerCase();
    let list = editable.filter((f) => f.kind !== "image");
    if (!showAll && !q) list = list.filter((f) => f.required);
    if (q) {
      list = list.filter(
        (f) => f.title.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [editable, showAll, fieldFilter]);

  const grouped = useMemo(() => {
    const m = new Map<string, FormField[]>();
    for (const f of visible) {
      const list = m.get(f.group) ?? [];
      list.push(f);
      m.set(f.group, list);
    }
    return Array.from(m.entries());
  }, [visible]);

  const requiredFields = useMemo(() => editable.filter((f) => f.required), [editable]);
  const doneCount = useMemo(
    () => requiredFields.filter((f) => !isEmpty(values[f.name])).length,
    [requiredFields, values]
  );
  const errors = useMemo(() => localValidate(editable, values), [editable, values]);
  const complete = requiredFields.length > 0 && doneCount === requiredFields.length;

  const mainImage = str(values["main_product_image_locator"]);
  const previewTitle = str(values["item_name"]);
  const previewBrand = str(values["brand"]);
  const previewBullets = Array.isArray(values["bullet_point"])
    ? (values["bullet_point"] as string[]).filter(Boolean)
    : [];

  const skuClash = useMemo(() => {
    const s = sku.trim().toUpperCase();
    if (!s) return null;
    const hit = catalog.find(
      (p) => p.style?.toUpperCase() === s || p.style10?.toUpperCase() === s
    );
    if (hit) return `Already on Amazon as ${hit.asin}.`;
    const dupe = subs.find((x) => x.sku.toUpperCase() === s && x.id !== editingId);
    if (dupe) return `Another submission (${STATUS_LABEL[dupe.status]}) uses this SKU.`;
    return null;
  }, [sku, catalog, subs, editingId]);

  const payload = useMemo(
    () => ({ productType, requirements: "LISTING", attributes: buildPreview(editable, values) }),
    [productType, editable, values]
  );

  const dirty = useRef(false);
  const persistRef = useRef<(s?: SubmissionStatus, silent?: boolean) => Promise<void>>(
    async () => {}
  );

  useEffect(() => {
    if (!editingId || !dirty.current) return;
    const t = setTimeout(() => {
      void persistRef.current(undefined, true);
      dirty.current = false;
    }, 2000);
    return () => clearTimeout(t);
  }, [values, sku, editingId]);

  const setField = useCallback((name: string, v: unknown) => {
    dirty.current = true;
    setValues((prev) => ({ ...prev, [name]: v }));
  }, []);

  const persist = useCallback(
    async (st?: SubmissionStatus, silent = false) => {
      if (!sku.trim()) {
        say("bad", "Add a SKU before saving.");
        return;
      }
      if (!silent) setSaving(true);
      const r = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, sku, productType, status: st, values }),
      });
      const j = (await r.json()) as { submission?: Submission; error?: string };
      if (!silent) setSaving(false);
      if (j.error) {
        say("bad", j.error);
        return;
      }
      if (j.submission) setEditingId(j.submission.id);
      if (!silent) say("ok", st ? `Saved as ${STATUS_LABEL[st]}.` : "Saved.");
      void loadSubs();
    },
    [sku, editingId, productType, values, loadSubs, say]
  );
  persistRef.current = persist;

  /** Start blank — clears the form AND the product type, and says so. */
  const startBlank = useCallback(() => {
    setEditingId(null);
    setSku("");
    setValues({});
    setClonedFrom(null);
    setCloneOpen(false);
    setFieldFilter("");
    setProductType(DEFAULT_TYPE);
    dirty.current = false;
    say("ok", "Cleared. Pick a product type and start filling.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [say]);

  function loadDraft(s: Submission) {
    setEditingId(s.id);
    setSku(s.sku);
    setProductType(s.productType);
    setValues(s.values ?? {});
    setClonedFrom(null);
    setStatus(null);
    dirty.current = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const cloneFrom = useCallback(
    async (p: SlimProduct) => {
      setCloneOpen(false);
      say("busy", `Loading ${p.style10 ?? p.style ?? p.asin}…`);

      let r: Response;
      try {
        r = await fetch(`/api/prefill?asin=${encodeURIComponent(p.asin)}`);
      } catch {
        say("bad", "Couldn't reach the server.");
        return;
      }

      const j = (await r.json()) as {
        productType?: string;
        inferred?: boolean;
        values?: Record<string, unknown>;
        filled?: number;
        hadAttributes?: boolean;
        error?: string;
      };

      if (!r.ok || j.error) {
        say("bad", j.error ?? `Clone failed (${r.status}).`);
        return;
      }

      setEditingId(null);
      setSku("");
      if (j.productType) setProductType(j.productType);
      setValues(j.values ?? {});
      setClonedFrom(p.style10 ?? p.style ?? p.asin);
      dirty.current = false;
      window.scrollTo({ top: 0, behavior: "smooth" });

      const n = j.filled ?? 0;
      const guessed = j.inferred
        ? " Product type was inferred from the title — check it's right."
        : "";

      if (n === 0) {
        say("warn", `Nothing to copy from ${p.asin}.${guessed}`);
      } else if (j.hadAttributes === false) {
        say(
          "warn",
          `Copied ${n} field${n === 1 ? "" : "s"} from what we have.${guessed} Full attributes need the Product Listing role, so the rest is blank.`
        );
      } else {
        say(
          "ok",
          `Copied ${n} field${n === 1 ? "" : "s"}.${guessed} Give it a new SKU and change what differs.`
        );
      }
    },
    [say]
  );

  async function remove(id: string) {
    await fetch(`/api/submissions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (editingId === id) startBlank();
    void loadSubs();
  }

  const fillImageSlots = useCallback((urls: string[]) => {
    setValues((prev) => {
      const next = { ...prev };
      let i = 0;
      for (const name of IMAGE_ORDER) {
        if (i >= urls.length) break;
        if (isEmpty(next[name])) {
          next[name] = urls[i];
          i += 1;
        }
      }
      return next;
    });
    dirty.current = true;
  }, []);

  const cloneMatches = useMemo(() => {
    const q = cloneQuery.trim().toLowerCase();
    const base = q
      ? catalog.filter(
          (p) =>
            p.title?.toLowerCase().includes(q) ||
            p.style?.toLowerCase().includes(q) ||
            p.style10?.toLowerCase().includes(q) ||
            p.asin.toLowerCase().includes(q)
        )
      : catalog;
    return base.slice(0, 50);
  }, [catalog, cloneQuery]);

  const typeLabel =
    allTypes.find((t) => t.name === productType)?.displayName ??
    productType.replace(/_/g, " ").toLowerCase();

  return (
    <div className="np">
      <header className="np-head">
        <div className="np-head-main">
          <div className="np-eyebrow">
            New listing
            {clonedFrom && <span className="np-tag">cloned from {clonedFrom}</span>}
            {editingId && <span className="np-tag saved">autosaving</span>}
          </div>
          <h1 className={previewTitle ? "" : "ghost"}>{previewTitle || "Untitled product"}</h1>
          <div className="np-sub">
            <span className="np-type">{typeLabel}</span>
            <span className="np-dot">·</span>
            <span>{sku.trim() || "no SKU yet"}</span>
            {requiredFields.length > 0 && (
              <>
                <span className="np-dot">·</span>
                <span className={complete ? "ok" : ""}>
                  {doneCount}/{requiredFields.length} required
                </span>
              </>
            )}
          </div>
        </div>
        <div className="np-head-actions">
          <button className="btn-ghost" onClick={() => void persist("draft")} disabled={saving}>
            Save draft
          </button>
          <button
            className="btn"
            onClick={() => void persist("ready")}
            disabled={saving || !complete || errors.length > 0}
            title={!complete ? `${requiredFields.length - doneCount} required fields left` : undefined}
          >
            Mark ready
          </button>
        </div>
      </header>

      {catalogWarning && (
        <div className="np-notice">
          <strong>Catalog data is limited</strong>
          <p>
            Amazon returns an ASIN&apos;s product type, bullets and full attributes only to apps
            with the <b>Product Listing</b> role, which this SP-API app doesn&apos;t have. Cloning
            still works — it copies the title and images recovered from A+ content and asks Amazon
            to infer the product type — but most fields will come back blank until the role is added
            and the token re-authorized.
          </p>
        </div>
      )}

      {/* status is always visible — never buried down the page */}
      {status && (
        <div className={`np-status ${status.kind}`}>
          <span>{status.text}</span>
          <button onClick={() => setStatus(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {amazonIssues.length > 0 && (
        <div className="np-amazon-issues">
          <div className="np-amazon-issues-head">Amazon returned {amazonIssues.length} issue(s)</div>
          <ul>
            {amazonIssues.map((iss, i) => (
              <li key={i}>
                {iss.attributeName && <code>{iss.attributeName}</code>} {iss.message}
                <span className="np-issue-code">{iss.code}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="np-grid">
        <main className="np-main">
          {/* ① identify */}
          <section className="np-sec">
            <SecHead n="1" title="Identify" note="The product type decides every field below it." />

            <div className="np-card">
              <div className="np-startrow">
                <button className="btn-ghost" onClick={startBlank}>
                  Start blank
                </button>
                <button className="btn-ghost" onClick={() => setCloneOpen((o) => !o)}>
                  {cloneOpen ? "Close catalog" : "Clone an existing product"}
                </button>
                {catalog.length === 0 && (
                  <span className="np-hint">Catalog is empty — run a sync to enable cloning.</span>
                )}
              </div>

              {cloneOpen && (
                <div className="np-clone">
                  <input
                    type="search"
                    autoFocus
                    placeholder={`Search ${catalog.length} products by style, title or ASIN`}
                    value={cloneQuery}
                    onChange={(e) => setCloneQuery(e.target.value)}
                  />
                  <div className="np-clone-list">
                    {cloneMatches.length === 0 && (
                      <div className="np-empty">
                        {catalog.length === 0
                          ? "No catalog yet. Run a sync from Overview."
                          : "Nothing matches."}
                      </div>
                    )}
                    {cloneMatches.map((p) => (
                      <button
                        key={p.asin}
                        type="button"
                        className="np-clone-row"
                        onClick={() => void cloneFrom(p)}
                      >
                        {p.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail} alt="" />
                        ) : (
                          <span className="np-clone-noimg" />
                        )}
                        <span>
                          <strong>{p.style10 ?? p.style ?? p.asin}</strong>
                          <em>{p.title ?? p.asin}</em>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="np-two">
                <div className="np-f">
                  <label htmlFor="sku">
                    SKU / style code <b>*</b>
                  </label>
                  <input
                    id="sku"
                    type="text"
                    value={sku}
                    onChange={(e) => {
                      dirty.current = true;
                      setSku(e.target.value);
                    }}
                    placeholder="M011R10"
                  />
                  <p className={skuClash ? "np-hint bad" : "np-hint"}>
                    {skuClash ?? "Matches the listing back to your catalog once it goes live."}
                  </p>
                </div>

                <TypePicker
                  all={allTypes}
                  loading={typesLoading}
                  value={productType}
                  onPick={setProductType}
                />
              </div>

              {catalogTypes.length > 0 && (
                <div className="np-catalog-types">
                  <span className="np-minilabel">Types you already sell</span>
                  <div className="np-chips">
                    {catalogTypes.map((t) => (
                      <button
                        key={t.name}
                        className={productType === t.name ? "np-chip on" : "np-chip"}
                        onClick={() => setProductType(t.name)}
                        title={`${t.count} live`}
                      >
                        {t.name.replace(/_/g, " ").toLowerCase()}
                        <b>{t.count}</b>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {loadingSchema && (
            <div className="np-card np-loading">Loading the {typeLabel} schema from Amazon…</div>
          )}

          {schemaError && (
            <div className="np-card np-error">
              <strong>Amazon didn&apos;t return a schema</strong>
              <p>{schemaError}</p>
            </div>
          )}

          {schema && !loadingSchema && (
            <>
              {/* ② describe */}
              <section className="np-sec">
                <SecHead
                  n="2"
                  title="Describe"
                  note={`${schema.requiredCount} required, ${editable.length} editable — straight from Amazon's schema.`}
                />

                <div className="np-toolbar">
                  <input
                    type="search"
                    placeholder={`Find a field among ${editable.length}`}
                    value={fieldFilter}
                    onChange={(e) => setFieldFilter(e.target.value)}
                  />
                  <label className="np-switch">
                    <input
                      type="checkbox"
                      checked={showAll}
                      onChange={(e) => setShowAll(e.target.checked)}
                    />
                    <span>Show optional fields</span>
                  </label>
                </div>

                {grouped.map(([group, gfields]) => (
                  <div className="np-card" key={group}>
                    <div className="np-grouphead">{group}</div>
                    {gfields.map((f) => (
                      <Field
                        key={f.name}
                        field={f}
                        value={values[f.name]}
                        onChange={(v) => setField(f.name, v)}
                      />
                    ))}
                  </div>
                ))}

                {visible.length === 0 && fieldFilter && (
                  <div className="np-card np-empty">Nothing matches “{fieldFilter}”.</div>
                )}
              </section>

              {/* ③ images */}
              {imageFields.length > 0 && (
                <section className="np-sec">
                  <SecHead
                    n="3"
                    title="Images"
                    note="Drop files, paste from the clipboard, or click a slot. Amazon wants 1000px+ for zoom."
                  />
                  <ImagePanel
                    fields={imageFields}
                    values={values}
                    sku={sku}
                    mode={imageMode}
                    onSet={setField}
                    onFillMany={fillImageSlots}
                    say={say}
                  />
                </section>
              )}

              {/* ④ review */}
              <section className="np-sec">
                <SecHead
                  n="4"
                  title="Review"
                  note="This is the exact body the Listings Items API takes."
                />

                <div className="np-card">
                  {errors.length > 0 ? (
                    <ul className="np-errs">
                      {errors.slice(0, 6).map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                      {errors.length > 6 && <li>+{errors.length - 6} more</li>}
                    </ul>
                  ) : complete ? (
                    <div className="np-ok">Every required field is filled.</div>
                  ) : (
                    <div className="np-pending">
                      {requiredFields.length - doneCount} required field
                      {requiredFields.length - doneCount === 1 ? "" : "s"} still empty.
                    </div>
                  )}

                  <div className="np-actions">
                    <button className="btn" onClick={() => void persist("draft")} disabled={saving}>
                      Save draft
                    </button>
                    <button
                      className="btn"
                      onClick={() => void submitToAmazon()}
                      disabled={saving || !complete || errors.length > 0 || !editingId}
                      title={
                        !editingId
                          ? "Save the draft first"
                          : !complete
                            ? "Fill every required field first"
                            : "Push this listing to Amazon via the Listings Items API"
                      }
                    >
                      {saving ? "Submitting…" : "Submit to Amazon"}
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => void persist("submitted")}
                      disabled={saving || !complete || errors.length > 0 || !editingId}
                      title="Mark submitted without calling the API (if you listed elsewhere)"
                    >
                      Mark submitted manually
                    </button>
                    {editingId && (
                      <a
                        className="btn-ghost"
                        href={`/api/submissions/${editingId}/payload?download=1`}
                      >
                        Download JSON
                      </a>
                    )}
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                        say("ok", "Payload copied.");
                      }}
                    >
                      Copy payload
                    </button>
                    <button className="np-linkbtn" onClick={() => setShowPayload((v) => !v)}>
                      {showPayload ? "Hide" : "Show"} JSON
                    </button>
                  </div>

                  {showPayload && <pre className="np-json">{JSON.stringify(payload, null, 2)}</pre>}
                </div>

                {unsupported.length > 0 && (
                  <details className="np-card np-details">
                    <summary>{unsupported.length} attributes are set in Vendor Central</summary>
                    <p>
                      Composite attributes — prices need a currency, dimensions need
                      height/width/length, barcodes need an ID type. Left out on purpose rather than
                      sending a payload Amazon rejects.
                    </p>
                    <ul>
                      {unsupported.map((f) => (
                        <li key={f.name}>
                          <code>{f.name}</code> {f.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            </>
          )}
        </main>

        <aside className="np-rail">
          <div className="np-preview">
            <div className="np-preview-head">As it will appear</div>
            <div className="np-preview-body">
              <div className="np-preview-img">
                {mainImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mainImage}
                    alt=""
                    onError={(e) => (e.currentTarget.style.opacity = "0.2")}
                  />
                ) : (
                  <span>no main image</span>
                )}
              </div>
              <div className="np-preview-copy">
                <div className={previewTitle ? "np-preview-title" : "np-preview-title ghost"}>
                  {previewTitle || "Your product title goes here"}
                </div>
                {previewBrand && <div className="np-preview-brand">by {previewBrand}</div>}
                {previewBullets.length > 0 ? (
                  <ul>
                    {previewBullets.slice(0, 5).map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                ) : (
                  <ul className="ghost">
                    <li>Bullet points appear here</li>
                  </ul>
                )}
              </div>
            </div>
          </div>

          {requiredFields.length > 0 && (
            <div className="np-rail-card">
              <div className="np-rail-head">
                <span>Amazon requires</span>
                <span className={complete ? "np-count ok" : "np-count"}>
                  {doneCount}/{requiredFields.length}
                </span>
              </div>
              <div className="np-meter">
                <div
                  className={complete ? "np-meter-fill done" : "np-meter-fill"}
                  style={{ width: `${(doneCount / requiredFields.length) * 100}%` }}
                />
              </div>
              <ul className="np-checks">
                {requiredFields.map((f) => {
                  const filled = !isEmpty(values[f.name]);
                  return (
                    <li key={f.name} className={filled ? "on" : ""}>
                      <span className="np-tick">{filled ? "✓" : ""}</span>
                      <span className="np-check-label">{f.title}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="np-rail-card">
            <div className="np-rail-head">
              <span>Submissions</span>
              <span className="np-count">{subs.length}</span>
            </div>
            {subs.length === 0 ? (
              <p className="np-empty">Nothing yet. Save a draft to start one.</p>
            ) : (
              <ul className="np-subs">
                {subs.map((s) => (
                  <li key={s.id} className={s.id === editingId ? "on" : ""}>
                    <button onClick={() => loadDraft(s)}>
                      <strong>{s.sku}</strong>
                      <em>{s.asin ?? s.productType.replace(/_/g, " ").toLowerCase()}</em>
                    </button>
                    <span className={`np-badge ${s.status}`}>{STATUS_LABEL[s.status]}</span>
                    <button className="np-x" onClick={() => void remove(s.id)} aria-label="Delete">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="np-foot">
              Submitted listings turn <b>Live</b> on their own once the ASIN shows up in a catalog
              sync.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── product type combobox over Amazon's full list ─────────────────────────

function TypePicker({
  all,
  loading,
  value,
  onPick,
}: {
  all: ProductTypeSummary[];
  loading: boolean;
  value: string;
  onPick: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all.slice(0, 60);
    return all
      .filter(
        (t) =>
          t.displayName.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle)
      )
      .slice(0, 60);
  }, [all, q]);

  const current = all.find((t) => t.name === value);

  return (
    <div className="np-f np-typepick">
      <label htmlFor="ptype">
        Product type
        <span className="np-ctr">
          {loading ? "loading…" : `${all.length.toLocaleString()} available`}
        </span>
      </label>

      <button
        id="ptype"
        type="button"
        className="np-typebtn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{current?.displayName ?? value.replace(/_/g, " ").toLowerCase()}</span>
        <em>{open ? "▲" : "▼"}</em>
      </button>

      {open && (
        <div className="np-typelist">
          <input
            type="search"
            autoFocus
            placeholder="Search every Amazon product type"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul>
            {matches.length === 0 && <li className="np-empty">Nothing matches “{q}”.</li>}
            {matches.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  className={t.name === value ? "on" : ""}
                  onClick={() => {
                    onPick(t.name);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <strong>{t.displayName}</strong>
                  <em>{t.name}</em>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="np-hint">Every product type Amazon offers, not just the ones you sell today.</p>
    </div>
  );
}

// ─── section head ──────────────────────────────────────────────────────────

function SecHead({ n, title, note }: { n: string; title: string; note: string }) {
  return (
    <div className="np-sechead">
      <span className="np-n">{n}</span>
      <div>
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
    </div>
  );
}

// ─── images ────────────────────────────────────────────────────────────────

function ImagePanel({
  fields,
  values,
  sku,
  mode,
  onSet,
  onFillMany,
  say,
}: {
  fields: FormField[];
  values: Record<string, unknown>;
  sku: string;
  mode: ImageMode | null;
  onSet: (name: string, v: unknown) => void;
  onFillMany: (urls: string[]) => void;
  say: (k: Status["kind"], t: string) => void;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const pickRef = useRef<HTMLInputElement>(null);

  const canUpload = mode === "public" || mode === "proxy";

  const uploadAll = useCallback(
    async (files: File[]) => {
      if (!canUpload || files.length === 0) return;

      const small: string[] = [];
      for (const f of files) {
        const [w, h] = await new Promise<[number, number]>((resolve) => {
          const probe = new window.Image();
          probe.onload = () => resolve([probe.naturalWidth, probe.naturalHeight]);
          probe.onerror = () => resolve([0, 0]);
          probe.src = URL.createObjectURL(f);
        });
        if (w && Math.max(w, h) < 1000) small.push(`${f.name} (${w}×${h})`);
      }

      setBusy(files.length);
      const urls: string[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("sku", sku);
        const r = await fetch("/api/images", { method: "POST", body: fd });
        const j = (await r.json()) as { url?: string; error?: string };
        if (j.error) {
          say("bad", j.error);
          break;
        }
        if (j.url) urls.push(j.url);
        setBusy((n) => n - 1);
      }
      setBusy(0);

      if (urls.length) {
        onFillMany(urls);
        say(
          small.length ? "warn" : "ok",
          small.length
            ? `Uploaded ${urls.length}. Under 1000px so Amazon won't zoom: ${small.join(", ")}`
            : `Uploaded ${urls.length} image${urls.length === 1 ? "" : "s"}.`
        );
      }
    },
    [canUpload, sku, onFillMany, say]
  );

  useEffect(() => {
    if (!canUpload) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length) {
        e.preventDefault();
        void uploadAll(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [canUpload, uploadAll]);

  const filled = fields.filter((f) => !isEmpty(values[f.name])).length;

  return (
    <>
      {mode === "proxy" && (
        <div className="np-warn">
          Uploads are working, but they&apos;re served from this app, which sits behind sign-in — so
          Amazon can&apos;t fetch them. Fine for drafting. Before a real submission, create a public
          image bucket and set <code>GCS_IMAGE_BUCKET</code>.
        </div>
      )}

      {mode === "off" && (
        <div className="np-card np-setup">
          <strong>Uploads are off</strong>
          <p>No storage bucket is configured. Paste image URLs into the slots below instead.</p>
        </div>
      )}

      {canUpload && (
        <div
          className={over ? "np-drop over" : "np-drop"}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void uploadAll(
              Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"))
            );
          }}
          onClick={() => pickRef.current?.click()}
          role="presentation"
        >
          <input
            ref={pickRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/tiff,image/webp"
            multiple
            hidden
            onChange={(e) => {
              void uploadAll(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          {busy > 0 ? (
            <span className="np-drop-title">Uploading {busy}…</span>
          ) : (
            <>
              <span className="np-drop-title">Drop images here, or click to choose files</span>
              <span className="np-drop-sub">
                Paste works too. Files fill the empty slots in order — the first becomes the main
                image. {filled} of {fields.length} slots used.
              </span>
            </>
          )}
        </div>
      )}

      <div className="np-slots">
        {fields.map((f) => (
          <Slot
            key={f.name}
            field={f}
            value={str(values[f.name])}
            sku={sku}
            canUpload={canUpload}
            onChange={(v) => onSet(f.name, v)}
            say={say}
          />
        ))}
      </div>
    </>
  );
}

function Slot({
  field: f,
  value,
  sku,
  canUpload,
  onChange,
  say,
}: {
  field: FormField;
  value: string;
  sku: string;
  canUpload: boolean;
  onChange: (v: string) => void;
  say: (k: Status["kind"], t: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const isMain = f.name === "main_product_image_locator";
  const label = isMain
    ? "Main"
    : f.name === "swatch_product_image_locator"
      ? "Swatch"
      : f.name.replace("other_product_image_locator_", "Alt ");
  const ok = /^(https?|s3):\/\//.test(value.trim());

  async function put(file: File) {
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("sku", sku);
    const r = await fetch("/api/images", { method: "POST", body: fd });
    const j = (await r.json()) as { url?: string; error?: string };
    setBusy(false);
    if (j.error) {
      say("bad", j.error);
      return;
    }
    if (j.url) onChange(j.url);
  }

  return (
    <div className={isMain ? "np-slot main" : "np-slot"}>
      <div className="np-slot-top">
        <span>{label}</span>
        {value && (
          <button onClick={() => onChange("")} aria-label="Clear">
            ✕
          </button>
        )}
      </div>
      <div
        className="np-slot-img"
        onClick={() => canUpload && ref.current?.click()}
        onDragOver={(e) => canUpload && e.preventDefault()}
        onDrop={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file?.type.startsWith("image/")) void put(file);
        }}
        role="presentation"
      >
        {value && ok ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" onError={(e) => (e.currentTarget.style.opacity = "0.2")} />
        ) : busy ? (
          <span>…</span>
        ) : (
          <span>{canUpload ? "+" : "URL"}</span>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/tiff,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void put(file);
          e.target.value = "";
        }}
      />
      <input
        type="text"
        className="np-mini"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://…"
      />
      {value && !ok && <p className="np-hint bad">Needs http(s):// or s3://</p>}
    </div>
  );
}

// ─── one field ─────────────────────────────────────────────────────────────

function Field({
  field: f,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const used = typeof value === "string" ? value.length : 0;
  const hint = f.description ? <p className="np-hint">{f.description}</p> : null;

  const head = (
    <label htmlFor={f.name}>
      {f.title} {f.required && <b>*</b>}
      {f.maxLength && used > 0 && (
        <span className={used > f.maxLength ? "np-ctr over" : "np-ctr"}>
          {used}/{f.maxLength}
        </span>
      )}
    </label>
  );

  const repeatable = (f.maxItems ?? 1) > 1 && (f.kind === "text" || f.kind === "textarea");

  if (repeatable) {
    const list = Array.isArray(value) ? (value as string[]) : value ? [String(value)] : [""];
    return (
      <div className="np-f">
        <label>
          {f.title} {f.required && <b>*</b>}
          <span className="np-ctr">
            up to {f.maxItems}
            {f.maxLength ? ` · ${f.maxLength} chars` : ""}
          </span>
        </label>
        {list.map((v, i) => (
          <div className="np-rep" key={i}>
            <textarea
              rows={2}
              value={v}
              maxLength={f.maxLength}
              onChange={(e) => {
                const next = [...list];
                next[i] = e.target.value;
                onChange(next);
              }}
              placeholder={f.examples?.[0] ?? ""}
            />
            {list.length > 1 && (
              <button
                className="np-x"
                onClick={() => onChange(list.filter((_, j) => j !== i))}
                aria-label="Remove"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {list.length < (f.maxItems ?? 1) && (
          <button className="np-add" onClick={() => onChange([...list, ""])}>
            + Add another ({list.length}/{f.maxItems})
          </button>
        )}
        {hint}
      </div>
    );
  }

  if (f.kind === "boolean") {
    return (
      <div className="np-f">
        {head}
        <select
          id={f.name}
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}
        >
          <option value="">Choose</option>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
        {hint}
      </div>
    );
  }

  if (f.kind === "select") {
    return (
      <div className="np-f">
        {head}
        <select
          id={f.name}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Choose one of {f.options?.length ?? 0}</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hint}
      </div>
    );
  }

  if (f.kind === "measure") {
    const m = (value ?? {}) as { value?: string | number; unit?: string };
    return (
      <div className="np-f">
        {head}
        <div className="np-measure">
          <input
            id={f.name}
            type="number"
            value={m.value ?? ""}
            onChange={(e) => onChange({ ...m, value: e.target.value })}
          />
          <select
            value={m.unit ?? ""}
            onChange={(e) => onChange({ ...m, unit: e.target.value || undefined })}
          >
            <option value="">Unit</option>
            {f.units?.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        {hint}
      </div>
    );
  }

  if (f.kind === "number" || f.kind === "integer") {
    return (
      <div className="np-f">
        {head}
        <input
          id={f.name}
          type="number"
          step={f.kind === "integer" ? 1 : "any"}
          value={typeof value === "number" || typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
        {hint}
      </div>
    );
  }

  if (f.kind === "textarea") {
    return (
      <div className="np-f">
        {head}
        <textarea
          id={f.name}
          rows={3}
          maxLength={f.maxLength}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.examples?.[0] ?? ""}
        />
        {hint}
      </div>
    );
  }

  return (
    <div className="np-f">
      {head}
      <input
        id={f.name}
        type="text"
        maxLength={f.maxLength}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={f.examples?.[0] ?? ""}
      />
      {hint}
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.filter((x) => x !== "" && x != null).length === 0;
  if (typeof v === "object") {
    const m = v as { value?: unknown };
    return m.value === undefined || m.value === "" || m.value === null;
  }
  return false;
}

function localValidate(fields: FormField[], values: Record<string, unknown>): string[] {
  const errs: string[] = [];
  for (const f of fields) {
    const raw = values[f.name];
    if (f.required && isEmpty(raw)) {
      errs.push(`${f.title} is required.`);
      continue;
    }
    if (isEmpty(raw)) continue;
    const list = Array.isArray(raw) ? raw : [raw];
    if (f.maxItems && list.length > f.maxItems) errs.push(`${f.title}: at most ${f.maxItems}.`);
    if (f.maxLength) {
      const over = list.some((v) => typeof v === "string" && v.length > (f.maxLength ?? 0));
      if (over) errs.push(`${f.title} is over ${f.maxLength} characters.`);
    }
    if (f.kind === "image") {
      const bad = list.some(
        (v) => typeof v === "string" && v.trim() !== "" && !/^(https?|s3):\/\//.test(v.trim())
      );
      if (bad) errs.push(`${f.title} must be a URL.`);
    }
  }
  return errs;
}

function buildPreview(
  fields: FormField[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.name];
    if (isEmpty(raw)) continue;
    const list = Array.isArray(raw) ? raw : [raw];
    const entries: Record<string, unknown>[] = [];
    for (const v of list) {
      if (v === undefined || v === null || v === "") continue;
      const entry: Record<string, unknown> = {};
      const vk = f.valueKey;
      if (f.kind === "measure") {
        const m = v as { value?: unknown; unit?: unknown };
        if (m?.value === undefined || m.value === "") continue;
        entry[vk] = Number(m.value);
        if (m.unit) entry.unit = m.unit;
      } else if (f.kind === "boolean") {
        entry[vk] = v === true || v === "true";
      } else if (f.kind === "number" || f.kind === "integer") {
        entry[vk] = Number(v);
      } else if (f.kind === "image") {
        entry[vk] = String(v).trim();
      } else {
        entry[vk] = v;
      }
      if (f.hasLanguageTag) entry.language_tag = "en_US";
      if (f.hasMarketplaceId) entry.marketplace_id = "ATVPDKIKX0DER";
      entries.push(entry);
    }
    if (entries.length) out[f.name] = entries;
  }
  return out;
}
