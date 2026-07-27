import { notFound } from "next/navigation";
import { readAggregate } from "@/lib/cache";
import ProductDetail from "@/components/ProductDetail";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ asin: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { asin } = await params;
  const { tab } = await searchParams;
  const agg = await readAggregate();
  const product = agg?.products.find((p) => p.asin === asin);
  if (!product || !agg) notFound();

  return (
    <ProductDetail
      product={product}
      meta={agg.meta}
      totalsCurrency={agg.totals.sales.currency}
      initialTab={tab}
    />
  );
}
