import {
  ActionButton,
  AuthVisible,
  ConfirmDialog,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Tooltip from '@mui/material/Tooltip';
import { useSnackbar } from 'notistack';
import { useState } from 'react';
import { Cluster } from '../../resources/cluster';
import { FENCE_ALL_INSTANCES } from '../../resources/fencing';
import { Pod } from '../common/podActions';

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Fencing is a metadata-annotation change on the Cluster (like hibernation), so this patches the
// main resource endpoint via Cluster.setInstanceFenced — the same `cnpg.io/fencedInstances`
// annotation `kubectl cnpg fencing on|off` manages. The operator then shuts the instance's
// postmaster down (or starts it again) asynchronously, after up to `.spec.switchoverDelay`.
export function FenceAction({ cluster, pod }: { cluster: Cluster; pod: Pod }) {
  const { enqueueSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  // Same allowed-until-checked pattern as switchover.tsx: ActionButton has no bare `disabled`
  // prop (only `iconButtonProps.disabled`), so the RBAC check is wired in directly.
  const [allowed, setAllowed] = useState(true);

  const instanceName = pod.getName();
  const fenced = cluster.isInstanceFenced(instanceName);
  const isPrimary = instanceName === cluster.currentPrimary;
  const fencedInstances = cluster.fencedInstances;

  // The operator refuses to unfence a single instance while the whole cluster is fenced, and
  // rejects an annotation it can't parse, so the action is disabled in both cases.
  let blockedMessage: string | undefined;
  if (fencedInstances === undefined) {
    blockedMessage = 'The cnpg.io/fencedInstances annotation has invalid syntax.';
  } else if (fenced && fencedInstances.includes(FENCE_ALL_INSTANCES)) {
    blockedMessage = 'All instances are fenced: lift fencing for the whole cluster instead.';
  }

  const description = fenced ? 'Unfence instance' : 'Fence instance';
  const disabledMessage = !allowed
    ? `You don't have permission to ${fenced ? 'unfence' : 'fence'} this instance.`
    : blockedMessage;

  const button = (
    <ActionButton
      description={description}
      icon={fenced ? 'mdi:lock-open-variant-outline' : 'mdi:lock-outline'}
      onClick={() => setOpen(true)}
      iconButtonProps={{ disabled: disabledMessage !== undefined }}
    />
  );

  return (
    <>
      <AuthVisible
        item={cluster}
        authVerb="patch"
        onAuthResult={({ allowed: result }) => setAllowed(result)}
      >
        {null}
      </AuthVisible>
      {disabledMessage === undefined ? (
        button
      ) : (
        <Tooltip title={disabledMessage}>
          <span>{button}</span>
        </Tooltip>
      )}
      <ConfirmDialog
        open={open}
        handleClose={() => setOpen(false)}
        title={fenced ? 'Unfence instance' : 'Fence instance'}
        description={
          fenced ? (
            <>
              This lifts fencing from <strong>{instanceName}</strong> and starts its PostgreSQL
              server again. Do you want to continue?
            </>
          ) : (
            <>
              <p>
                This fences <strong>{instanceName}</strong>: its PostgreSQL server is shut down
                while the pod is kept running, so its data can be inspected without being modified.
                The pod stops being Ready once the shutdown completes, which can take up to the
                cluster&apos;s switchover delay.
              </p>
              {isPrimary && (
                <p>
                  <strong>
                    This instance is the primary: no failover is performed, so applications
                    connected to the primary will lose access to the database until the fence is
                    lifted.
                  </strong>
                </p>
              )}
              <p>Do you want to continue?</p>
            </>
          )
        }
        onConfirm={() => {
          setOpen(false);
          cluster
            .setInstanceFenced(instanceName, !fenced)
            .then(() => {
              enqueueSnackbar(
                fenced
                  ? `Instance ${instanceName} is being unfenced`
                  : `Instance ${instanceName} is being fenced`,
                { variant: 'success' }
              );
            })
            .catch(error => {
              enqueueSnackbar(
                `Failed to ${fenced ? 'unfence' : 'fence'} instance ${instanceName}: ${formatError(
                  error
                )}`,
                { variant: 'error' }
              );
            });
        }}
      />
    </>
  );
}
