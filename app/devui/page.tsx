import { notFound } from "next/navigation";
import DevuiClient from "./DevuiClient";

export default function DevuiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevuiClient />;
}
