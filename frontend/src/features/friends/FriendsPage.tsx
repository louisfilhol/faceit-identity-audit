// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Spinner } from "@/components/common/Spinner";
import { queryKeys } from "@/api/keys";
import { ConfigCard } from "./ConfigCard";
import { EventsCard } from "./EventsCard";
import { OverlapCard } from "./OverlapCard";
import { StatusCard } from "./StatusCard";
import { WatchListCard } from "./WatchListCard";
import {
  useAccountLabels,
  useEvents,
  useFriendsCheckToasts,
  useFriendsConfig,
  useFriendsStatus,
  useRunFriendsCheck,
  useSnapshots,
} from "./queries";

export function FriendsPage() {
  const queryClient = useQueryClient();
  const statusQuery = useFriendsStatus();
  const configQuery = useFriendsConfig();
  const eventsQuery = useEvents();
  const snapshotsQuery = useSnapshots();
  const label = useAccountLabels();
  const check = useRunFriendsCheck();
  useFriendsCheckToasts(check);

  const events = useMemo(
    () => eventsQuery.data?.events ?? [],
    [eventsQuery.data],
  );
  const snapshots = useMemo(
    () => snapshotsQuery.data?.snapshots ?? [],
    [snapshotsQuery.data],
  );

  const refreshWatchList = () =>
    void queryClient.invalidateQueries({
      queryKey: queryKeys.friends.snapshots,
    });

  return (
    <section className="view active">
      <div className="view-head">
        <div>
          <h2>Friends Monitor</h2>
          <p className="sub">
            Track friend-list changes across FACEIT accounts and get Discord
            alerts.
          </p>
        </div>
        <div className="btn-group">
          <button type="button" className="btn" onClick={refreshWatchList}>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Watch list
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => check.mutate()}
            disabled={check.isPending}
          >
            {check.isPending ? <Spinner /> : null}
            {check.isPending ? "Scanning…" : "Run check now"}
          </button>
        </div>
      </div>

      <div className="grid-2">
        <StatusCard
          status={statusQuery.data}
          statusError={statusQuery.isError}
          scheduler={statusQuery.data?.scheduler}
          check={check}
        />
        <ConfigCard config={configQuery.data} />
      </div>

      <OverlapCard />
      <EventsCard events={events} />
      <WatchListCard snapshots={snapshots} label={label} />
    </section>
  );
}
