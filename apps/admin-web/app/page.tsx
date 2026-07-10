const states = [
  "loading",
  "empty",
  "error + retry",
  "permission denied",
  "ready + realtime",
] as const;
export default function Home() {
  return (
    <main>
      <span className="eyebrow">SPRINT 0 · ADMIN WEB</span>
      <h1>Nailsoft operations</h1>
      <p>
        Nền tảng vận hành salon đa chi nhánh, mobile-first và realtime-ready.
      </p>
      <section>
        <h2>UI state contract</h2>
        <ul>
          {states.map((state) => (
            <li key={state}>{state}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
