/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authorizedFetch } from "./auth";

export default function CustomerEngagement({
  mode,
}: {
  mode: "preferences" | "consents" | "unsubscribe" | "review";
}) {
  const params = useSearchParams(),
    [state, setState] = useState<
      "loading" | "ready" | "empty" | "error" | "forbidden"
    >("loading"),
    [data, setData] = useState<any>(null),
    [notice, setNotice] = useState(""),
    [rating, setRating] = useState("5"),
    [comment, setComment] = useState(""),
    [definitionId, setDefinitionId] = useState("");
  const token = params.get("token") ?? "";
  async function request(
    path: string,
    init?: RequestInit,
    authenticated = true,
  ) {
    const response = authenticated
        ? await authorizedFetch(path, init)
        : await fetch(path, init),
      body = await response.json().catch(() => ({}));
    if ([401, 403].includes(response.status)) {
      setState("forbidden");
      throw new Error("Permission denied");
    }
    if (!response.ok)
      throw new Error(body.error?.message ?? "Unable to complete request");
    return body.data;
  }
  async function load() {
    setState("loading");
    try {
      const value =
        mode === "preferences"
          ? await request("/v1/customer/me/communication-preferences")
          : mode === "consents"
            ? await request("/v1/customer/me/consents")
            : mode === "review"
              ? await request(
                  `/v1/public/reviews/request?token=${encodeURIComponent(token)}`,
                  undefined,
                  false,
                )
              : null;
      setData(value);
      setState(
        value && (Array.isArray(value) ? value.length : true)
          ? "ready"
          : "empty",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to load");
      setState("error");
    }
  }
  useEffect(() => {
    if (mode !== "unsubscribe") void load();
    else setState("ready");
  }, [mode, token]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setNotice("");
    try {
      if (mode === "preferences")
        await request("/v1/customer/me/communication-preferences/update", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            preferredLocale: data.preferredLocale,
            preferredTimezone: data.preferredTimezone,
            emailAddress: data.emailAddress,
            quietHoursStart: data.quietHoursStart?.slice(0, 5) || null,
            quietHoursEnd: data.quietHoursEnd?.slice(0, 5) || null,
            version: data.version,
          }),
        });
      else if (mode === "consents")
        await request("/v1/customer/me/consents/grant", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            purpose: "MARKETING_EMAIL",
            definitionId,
            evidence: { interaction: "customer-portal" },
          }),
        });
      else if (mode === "unsubscribe")
        await request(
          "/v1/public/communications/unsubscribe",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": crypto.randomUUID(),
            },
            body: JSON.stringify({ token }),
          },
          false,
        );
      else
        await request(
          "/v1/public/reviews/submit",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": crypto.randomUUID(),
            },
            body: JSON.stringify({
              token,
              overallRating: Number(rating),
              comment,
            }),
          },
          false,
        );
      setNotice(
        mode === "unsubscribe"
          ? "Your request has been accepted."
          : "Saved successfully.",
      );
      if (mode !== "unsubscribe" && mode !== "review") await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Retry safely");
    }
  }
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">CUSTOMER · EMAIL PREFERENCES</p>
        <h1>
          {mode === "preferences"
            ? "Communication preferences"
            : mode === "consents"
              ? "Consent choices"
              : mode === "unsubscribe"
                ? "Unsubscribe"
                : "Verified visit review"}
        </h1>
        <p className="hint">
          Your choices are recorded with evidence and take effect immediately.
        </p>
        {state === "loading" && <div className="skeleton">Loading…</div>}
        {state === "forbidden" && (
          <div className="state">Permission denied.</div>
        )}
        {state === "error" && (
          <div className="state">
            <p>{notice}</p>
            <button onClick={() => void load()}>Retry</button>
          </div>
        )}
        {state === "empty" && (
          <div className="state">No data is available.</div>
        )}
        {state === "ready" && (
          <form className="form-grid" onSubmit={submit}>
            {mode === "preferences" && (
              <>
                <label>
                  Locale
                  <select
                    value={data.preferredLocale}
                    onChange={(e) =>
                      setData({ ...data, preferredLocale: e.target.value })
                    }
                  >
                    <option>vi-VN</option>
                    <option>en-US</option>
                  </select>
                </label>
                <label>
                  Timezone
                  <input
                    value={data.preferredTimezone ?? ""}
                    onChange={(e) =>
                      setData({ ...data, preferredTimezone: e.target.value })
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={data.emailAddress ?? ""}
                    onChange={(e) =>
                      setData({ ...data, emailAddress: e.target.value })
                    }
                  />
                </label>
              </>
            )}
            {mode === "consents" && (
              <>
                <ul>
                  {data.map((x: any) => (
                    <li key={x.purpose}>
                      {x.purpose}: <strong>{x.state}</strong>
                    </li>
                  ))}
                </ul>
                <label>
                  Active consent definition ID
                  <input
                    required
                    value={definitionId}
                    onChange={(e) => setDefinitionId(e.target.value)}
                  />
                </label>
              </>
            )}
            {mode === "review" && (
              <>
                <p>Verified request: {data.tokenValid ? "Yes" : "No"}</p>
                <label>
                  Overall rating
                  <select
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                  >
                    {[5, 4, 3, 2, 1].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Comment
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </label>
              </>
            )}
            {mode === "unsubscribe" && (
              <p>
                Confirm withdrawal of marketing email consent. Transactional
                messages remain available.
              </p>
            )}
            <button>
              {mode === "unsubscribe"
                ? "Confirm unsubscribe"
                : mode === "review"
                  ? "Submit verified review"
                  : "Save"}
            </button>
          </form>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
      </section>
    </main>
  );
}
