import { ipcRenderer } from "electron";
import { GraphQLClient } from "graphql-request";
import { getSdk } from "src/generated/graphql-request";
import { get, NodeInfo } from "src/config";
import { ActivationFunction, ActivationStep } from "src/interfaces/activation";
import { useTx } from "src/utils/useTx";
import { useStore } from "./useStore";
import { useTransactionResultLazyQuery } from "src/generated/graphql";
import { sleep } from "src/utils";

export function usePledge() {
  const tx = useTx();
  const account = useStore("account");

  const [fetchStatus, { loading, data: txState, stopPolling }] =
    useTransactionResultLazyQuery({
      pollInterval: 1000,
      fetchPolicy: "no-cache",
    });

  const activate: ActivationFunction = async (
    requestPledgeTxId: string | null
  ) => {
    let step: ActivationStep = "preflightCheck";

    if (!account.loginSession) {
      return {
        result: false,
        error: {
          error: new Error("No private key"),
          step,
        },
      };
    }

    step = "getGraphQLClient";
    const nodeInfo: NodeInfo = await ipcRenderer.invoke("get-node-info");

    const sdks = getSdk(
      new GraphQLClient(
        `http://${nodeInfo.host}:${nodeInfo.graphqlPort}/graphql`
      )
    );

    try {
      const { data } = await sdks.CheckContracted({
        agentAddress: account.loginSession.address.toHex(),
      });
      const { contracted, patronAddress } = data.stateQuery.contracted;
      if (!contracted) {
        if (patronAddress === null && requestPledgeTxId !== null) {
          //If requestPledgeTxId is null, consider it's approve scenario
          step = "checkPledgeRequestTx";

          fetchStatus({ variables: { txId: requestPledgeTxId } });
          let pollCount = 0;
          while (loading) {
            pollCount++;
            switch (txState?.transaction.transactionResult.txStatus) {
              case "SUCCESS":
                stopPolling?.();
                break;
              case "FAILURE":
                return {
                  result: false,
                  error: {
                    error: new Error("RequestPledge Tx Staging Failed."),
                    step,
                  },
                };
              case "INVALID":
              case "STAGING":
                break;
            }
            await sleep(1000);
            if (pollCount >= 60) {
              stopPolling?.();
              return {
                result: false,
                error: {
                  error: new Error(
                    "RequestPledge Tx Staging Confirmation Timeout."
                  ),
                  step: step,
                },
              };
            }
          }
        }
        step = "createApprovePledgeTx";
        const { data } = await sdks.approvePledge({
          publicKey: account.loginSession.publicKey.toHex("uncompressed"),
        });

        if (!data?.actionTxQuery.approvePledge) {
          return {
            result: false,
            error: {
              error: new Error("ApprovePledge ActionTxQuery Failed"),
              step,
            },
          };
        }

        step = "stageTx";
        const { data: txData } = await tx(data?.actionTxQuery.approvePledge);
        if (!txData?.stageTransaction) {
          return {
            result: false,
            error: {
              error: new Error("Tx Staging Failed"),
              step,
            },
          };
        }
        return {
          result: true,
          txId: txData.stageTransaction,
        };
      }
      return {
        result: true,
      };
    } catch (e: unknown) {
      if (e instanceof Error) {
        return {
          result: false,
          error: {
            error: e,
            step: step,
          },
        };
      }
      throw e;
    }
  };
  return activate;
}
