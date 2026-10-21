import { config } from "../lib/config";

export default async function Home() {
  const res = await fetch(`${config.apiBaseUrl}/products`, { cache: "no-store" });
  const products: Array<{ id: string; name: string }> = await res.json();
  return (
    <main>
      <h1>Catalogue</h1>
      <ul>{products.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
    </main>
  );
}
