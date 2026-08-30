// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
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
import { overlapFriendIds } from "@/features/overview/overlap";

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
  const overlapIds = useMemo(
    () => overlapFriendIds(snapshots, label),
    [snapshots, label],
  );

  const refreshWatchList = () =>
    void queryClient.invalidateQueries({
      queryKey: queryKeys.friends.snapshots,
    });

  return (
    <section className="view active">
      <div className="view-head">
        <div>
          <h2>Friend activity</h2>
          <p className="sub">
            Review shared connections and changes across the accounts you watch.
          </p>
        </div>
        <div className="btn-group">
          <button type="button" className="btn" onClick={refreshWatchList}>
            <Eye size={16} aria-hidden="true" />
            People
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => check.mutate()}
            disabled={check.isPending}
          >
            {check.isPending ? <Spinner /> : null}
            {check.isPending ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>

      <StatusCard
        status={statusQuery.data}
        statusError={statusQuery.isError}
        scheduler={statusQuery.data?.scheduler}
        check={check}
      />

      <details className="setup-disclosure">
        <summary>Accounts &amp; notifications</summary>
        <ConfigCard config={configQuery.data} />
      </details>

      <OverlapCard />
      <EventsCard events={events} overlapIds={overlapIds} />
      <WatchListCard snapshots={snapshots} label={label} />
    </section>
  );
}
