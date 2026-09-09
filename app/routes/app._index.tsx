import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

// The actual gallery page lives at /app/galeria, not here. See the comment
// at the top of app.galeria.tsx for why an index route doesn't work for it.
export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  url.pathname = "/app/galeria";
  return redirect(url.toString());
};
