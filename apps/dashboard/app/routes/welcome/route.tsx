import { AccountOverview } from "../../features/account/public.js";
export function meta() {
  return [{ title: "Holon" }];
}
export default function Welcome() {
  return <AccountOverview />;
}
