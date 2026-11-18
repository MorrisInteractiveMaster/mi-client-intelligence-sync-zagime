import { safeId } from "./contracts";
import { mountedTimeToken, TimeClient, timeId, workDate } from "./time-client";
import { TimeSync } from "./time-sync";
import type { ProjectStore } from "./project-workspace";

export function configureTime(
  store: ProjectStore,
  mode: string,
  env: NodeJS.ProcessEnv,
) {
  if (env.ENABLE_QUICKBOOKS_TIME !== "true") return new TimeSync(store);
  if (mode !== "staging") throw Error("Time requires approved staging");
  const required = (key: string) => {
    const value = env[key];
    if (!value) throw Error("Incomplete Time configuration");
    return value;
  };
  const tenant = safeId(required("MORRIS_DASHBOARD_TENANT_ID"));
  const clientUrl = required("QUICKBOOKS_TIME_CLIENT_URL");
  const jobcodes = [
    ...new Set(
      required("QUICKBOOKS_TIME_APPROVED_JOBCODES").split(",").map(timeId),
    ),
  ];
  if (!/^[a-zA-Z0-9_\-]{1,100}$/.test(clientUrl) || jobcodes.length > 25)
    throw Error("Invalid Time scope");
  return new TimeSync(
    store,
    {
      tenant,
      clientUrl,
      jobcodes,
      account: timeId(required("QUICKBOOKS_TIME_ACCOUNT_ID")),
      userId: timeId(required("QUICKBOOKS_TIME_CREDENTIAL_USER_ID")),
      admin: safeId(required("QUICKBOOKS_TIME_ADMIN_UID")),
      from: workDate(required("QUICKBOOKS_TIME_MODIFIED_FROM")),
    },
    new TimeClient(mountedTimeToken(required("QUICKBOOKS_TIME_TOKEN_FILE"))),
  );
}
