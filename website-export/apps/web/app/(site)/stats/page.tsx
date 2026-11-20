import { redirect } from "next/navigation";
/** SPEC §11 names a public /stats page; the site keeps it on /proof#stats. */
export default function Stats() { redirect("/proof#stats"); }
