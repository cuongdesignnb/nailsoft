/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useState } from "react";
import { authorizedFetch } from "../auth";

function message(body: any, fallback: string) {
  return body?.error?.message ?? body?.message ?? fallback;
}

export default function CustomerCreate() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const [existing, setExisting] = useState<any>();
  const [notice, setNotice] = useState("");

  function validate(form: FormData) {
    const errors: string[] = [];
    if (!String(form.get("displayName") ?? "").trim()) errors.push("Display name is required.");
    if (!String(form.get("phone") ?? "").trim() && !String(form.get("email") ?? "").trim()) errors.push("Phone or email is required.");
    return errors;
  }

  async function findExisting(value: string) {
    if (!value.trim()) return undefined;
    const response = await authorizedFetch(`/v1/customers?search=${encodeURIComponent(value.trim())}&limit=5`);
    if (!response.ok) return undefined;
    const body = await response.json().catch(() => ({}));
    return Array.isArray(body?.data) ? body.data[0] : undefined;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setExisting(undefined);
    const form = new FormData(event.currentTarget);
    const errors = validate(form);
    setValidation(errors);
    if (errors.length) return;
    setValidation([]);
    setSubmitting(true);
    try {
      const phone = String(form.get("phone") ?? "").trim();
      const email = String(form.get("email") ?? "").trim();
      const candidate = await findExisting(phone || email);
      const response = await authorizedFetch("/v1/customers", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ displayName: String(form.get("displayName")), phone: phone || undefined, email: email || undefined, locale: String(form.get("locale")) }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 403) throw Object.assign(new Error(message(body, "Permission denied.")), { forbidden: true });
      if (!response.ok) throw new Error(message(body, "Unable to create customer."));
      const customer = body?.data;
      const duplicate = candidate && candidate.id === customer?.id;
      if (duplicate) {
        setExisting(customer);
        setNotice("An existing customer with this contact was found. The existing profile was opened instead.");
      } else {
        setNotice("Customer created successfully.");
      }
      window.setTimeout(() => { if (customer?.id) window.location.assign(`/admin/customers/${customer.id}`); }, 250);
    } catch (cause: any) {
      setError(cause?.message ?? "Unable to create customer.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="s19-customer-page">
    <header className="s19-page-heading"><div><p className="s19-eyebrow">CUSTOMER 360</p><h1>Create customer</h1><p>Add a tenant-wide customer profile. Contact information is used for safe duplicate detection.</p></div><div className="s19-page-actions"><a className="s19-button s19-button-secondary" href="/admin/customers">Back to customers</a></div></header>
    <section className="s19-form-card"><form className="s19-form-grid" onSubmit={(event) => void submit(event)} noValidate>
      <div className="s19-customer-form-intro"><h2>Customer details</h2><p className="s19-helper">A phone number or email is required. Marketing consent is not required to create a customer.</p></div>
      {validation.length ? <div className="s19-notice s19-notice-error" role="alert"><strong>Please check the form</strong><ul>{validation.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      <label className="s19-field" htmlFor="customer-display-name"><span>Display name</span><input id="customer-display-name" name="displayName" autoComplete="name" required /></label>
      <label className="s19-field" htmlFor="customer-phone"><span>Phone</span><input id="customer-phone" name="phone" type="tel" autoComplete="tel" /></label>
      <label className="s19-field" htmlFor="customer-email"><span>Email</span><input id="customer-email" name="email" type="email" autoComplete="email" /></label>
      <label className="s19-field" htmlFor="customer-locale"><span>Preferred locale</span><select id="customer-locale" name="locale" defaultValue="vi-VN"><option value="vi-VN">vi-VN</option><option value="en-US">en-US</option></select></label>
      <div className="s19-form-actions"><button className="s19-button s19-button-primary" type="submit" disabled={submitting}>{submitting ? "Creating..." : "Create customer"}</button></div>
    </form>{error ? <div className="s19-notice s19-notice-error" role="alert"><strong>{error.includes("Permission") ? "Permission denied" : "Unable to create customer"}</strong><span>{error}</span></div> : null}{notice ? <div className="s19-notice" role="status">{notice}</div> : null}{existing ? <div className="s19-card s19-duplicate-card"><h2>Existing customer found</h2><p>{existing.displayName} - {existing.phone ?? existing.email ?? "Contact matched"}</p><a className="s19-button s19-button-secondary" href={`/admin/customers/${existing.id}`}>Open existing profile</a></div> : null}</section>
  </main>;
}
