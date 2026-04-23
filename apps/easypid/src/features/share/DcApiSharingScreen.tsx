import type { DigitalCredentialsRequest } from '@animo-id/expo-digital-credentials-api'
import { getAptitudeSelection } from '@animo-id/expo-digital-credentials-api-aptitude-consortium'
import { initializeAppAgent } from '@easypid/agent'
import { WalletPinPromptHeader, WalletPinPromptInput } from '@easypid/components/WalletPinPrompt'
import { useLingui } from '@lingui/react/macro'
import {
  AgentProvider,
  BiometricAuthenticationError,
  BiometricAuthenticationCancelledError,
  type CredentialsForProofRequest,
  type EitherAgent,
  type FormattedTransactionData,
  type QesTransactionDataEntry,
  type Ts12TransactionDataEntry,
  getFormattedTransactionData,
  BiometricAuthenticationNotEnabledError,
} from '@package/agent'
import { resolveRequestForDcApi, sendErrorResponseForDcApi, sendResponseForDcApi } from '@package/agent/openid4vc/dcApi'
import { type PinDotsInputRef, Provider, type SlideStep, SlideWizard } from '@package/app'
import { secureWalletKey, useBiometricUnlockState } from '@package/secure-store/secureUnlock'
import { commonMessages } from '@package/translations'
import { HeroIcons, IconContainer, Paragraph, Spinner, Stack, YStack } from '@package/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import tamaguiConfig from '../../../tamagui.config'
import { storeWalletPinForBiometricsIfAvailable } from '../../crypto/biometricWalletPin'
import { InvalidPinError } from '../../crypto/error'
import { useStoredLocale } from '../../hooks/useStoredLocale'
import { SigningSlide } from './slides/SigningSlide'
import { getAdditionalPayload } from './slides/Ts12BaseSlide'
import { Ts12TransactionSlide } from './slides/Ts12TransactionSlide'

type DcApiSharingScreenProps = {
  request: DigitalCredentialsRequest
}

type TransactionSelection = {
  credentialId?: string
  additionalPayload?: object
}

const stripCredentialPrefix = (credentialId: string) =>
  credentialId.replace(/^(sd-jwt-vc-|mdoc-|w3c-credential-|w3c-v2-credential-)/, '')

export function DcApiSharingScreen({ request }: DcApiSharingScreenProps) {
  const [storedLocale] = useStoredLocale()

  return (
    <SafeAreaProvider>
      <Provider disableInjectCSS defaultTheme="light" config={tamaguiConfig} customLocale={storedLocale}>
        <Stack flex-1 justifyContent="flex-end">
          <DcApiSharingScreenWithContext request={request} />
        </Stack>
      </Provider>
    </SafeAreaProvider>
  )
}

export function DcApiSharingScreenWithContext({ request }: DcApiSharingScreenProps) {
  const [agent, setAgent] = useState<EitherAgent>()
  const [resolvedRequest, setResolvedRequest] = useState<CredentialsForProofRequest>()
  const [formattedTransactionData, setFormattedTransactionData] = useState<FormattedTransactionData>()
  const [selectedTransactionData, setSelectedTransactionData] = useState<TransactionSelection[]>([])
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [isAllowedToAutoPromptBiometrics, setIsAllowedToAutoPromptBiometrics] = useState(false)
  const [shouldPromptBiometrics, setShouldPromptBiometrics] = useState(true)
  const pinRef = useRef<PinDotsInputRef>(null)
  const hasAttemptedAutoBiometricsRef = useRef(false)
  const insets = useSafeAreaInsets()
  const { t } = useLingui()

  const biometricUnlockState = useBiometricUnlockState()
  const biometricsType =
    biometricUnlockState.data?.biometryType?.toLowerCase().includes('face') ||
    biometricUnlockState.data?.biometryType?.toLowerCase().includes('optic')
      ? 'face'
      : 'fingerprint'
  const showBiometricUnlockAction = biometricUnlockState.data?.canUnlockNow === true

  const unlockUsingPin = useCallback(
    async (pin: string) => {
      setIsUnlocking(true)

      const unlockedAgent = await secureWalletKey
        .getWalletKeyUsingPin(pin, secureWalletKey.getWalletKeyVersion())
        .then(async (walletKey) =>
          initializeAppAgent({
            walletKey,
            walletKeyVersion: secureWalletKey.getWalletKeyVersion(),
          })
        )
        .catch((e) => {
          if (e instanceof InvalidPinError) {
            pinRef.current?.clear()
            pinRef.current?.shake()
            return undefined
          }

          sendErrorResponseForDcApi('Error initializing wallet')
          return undefined
        })

      setIsUnlocking(false)
      if (!unlockedAgent) return
      await storeWalletPinForBiometricsIfAvailable(pin)
      setAgent(unlockedAgent)
    },
    [setAgent]
  )

  const unlockUsingBiometrics = useCallback(async () => {
    setIsUnlocking(true)

    const unlockedAgent = await secureWalletKey
      .getWalletKeyUsingBiometrics(secureWalletKey.getWalletKeyVersion())
      .then(async (walletKey) => {
        if (!walletKey) return undefined

        return initializeAppAgent({
          walletKey,
          walletKeyVersion: secureWalletKey.getWalletKeyVersion(),
        })
      })
      .catch((error) => {
        if (
          error instanceof BiometricAuthenticationCancelledError ||
          error instanceof BiometricAuthenticationNotEnabledError ||
          error instanceof BiometricAuthenticationError
        ) {
          return undefined
        }

        sendErrorResponseForDcApi('Error initializing wallet')
        return undefined
      })

    setIsUnlocking(false)
    if (!unlockedAgent) return
    setAgent(unlockedAgent)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setIsAllowedToAutoPromptBiometrics(true), 500)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (agent) {
      hasAttemptedAutoBiometricsRef.current = false
      return
    }

    if (
      !showBiometricUnlockAction ||
      !isAllowedToAutoPromptBiometrics ||
      !shouldPromptBiometrics ||
      hasAttemptedAutoBiometricsRef.current
    ) {
      return
    }

    hasAttemptedAutoBiometricsRef.current = true
    void unlockUsingBiometrics()
  }, [agent, isAllowedToAutoPromptBiometrics, shouldPromptBiometrics, showBiometricUnlockAction, unlockUsingBiometrics])

  useEffect(() => {
    if (!agent || resolvedRequest) return

    setIsResolving(true)
    resolveRequestForDcApi({ agent, request })
      .then(async (resolved) => {
        const formatted = await getFormattedTransactionData(resolved)
        setResolvedRequest(resolved)
        setFormattedTransactionData(formatted)
        if (formatted) {
          const defaults = formatted.map(() => ({} as TransactionSelection))
          const selectionCreds = getAptitudeSelection(request)?.creds ?? []

          if (selectionCreds.length > 0) {
            selectionCreds.forEach((cred) => {
              const indices = (cred.metadata as { transaction_data_indices?: number[] } | undefined)
                ?.transaction_data_indices
              if (!Array.isArray(indices)) return

              indices.forEach((index) => {
                const entry = formatted[index]
                if (!entry) return

                const selected = entry.formattedSubmissions
                  .flatMap((submission) => (submission.isSatisfied ? submission.credentials : []))
                  .find((c) => c.credential.id === cred.entryId)?.credential.id

                if (selected) {
                  defaults[index] = { credentialId: selected }
                }
              })
            })
          }

          // Payment transaction data is auto-approved: preselect first available credential.
          formatted.forEach((entry, index) => {
            if (entry.type !== 'urn:eudi:sca:payment:1') return
            if (defaults[index]?.credentialId) return

            const selected = entry.formattedSubmissions
              .flatMap((submission) => (submission.isSatisfied ? submission.credentials : []))
              .map((credential) => credential.credential.id)[0]

            if (selected) {
              defaults[index] = { credentialId: selected }
            }
          })

          setSelectedTransactionData(defaults)
        }
      })
      .catch((error) => {
        agent.config.logger.error('Error getting credentials for dc api request', {
          error,
        })
        sendErrorResponseForDcApi('Presentation information could not be extracted')
        setResolvedRequest(undefined)
        setFormattedTransactionData(undefined)
        setSelectedTransactionData([])
      })
      .finally(() => {
        setIsResolving(false)
      })
  }, [agent, request, resolvedRequest])

  const onTransactionDataSelect = useCallback((index: number, data: TransactionSelection) => {
    setSelectedTransactionData((prev) => {
      if (prev[index]?.credentialId === data.credentialId) return prev
      const next = [...prev]
      next[index] = data
      return next
    })
  }, [])

  const onDecline = useCallback(() => {
    sendErrorResponseForDcApi(t(commonMessages.informationRequestDeclined))
  }, [t])

  const onProofAccept = useCallback(async () => {
    if (!agent || !resolvedRequest) return

    const selectionCreds = getAptitudeSelection(request)?.creds ?? []
    const hasDcApiSelection = selectionCreds.length > 0

    try {
      // DC API already gates user presence before handing control to the wallet.
      // Avoid stacking a second in-app auth step here.
      const selectedCredentials: Record<string, string> = {}
      let acceptTransactionData: Array<{ credentialId: string; additionalPayload?: object }> | undefined

      if (hasDcApiSelection) {
        for (const credential of selectionCreds) {
          let queryId = (credential.metadata as { dcql_id?: string } | undefined)?.dcql_id
          if (!queryId) {
            const entry = resolvedRequest.formattedSubmission.entries.find(
              (candidate) =>
                candidate.isSatisfied &&
                candidate.credentials.some((candidateCredential) => candidateCredential.credential.id === credential.entryId)
            )
            if (entry) queryId = entry.inputDescriptorId
          }
          if (!queryId) continue

          if (credential.entryId.startsWith('__none__')) {
            selectedCredentials[queryId] = credential.entryId
          } else {
            selectedCredentials[queryId] = stripCredentialPrefix(credential.entryId)
          }
        }
      }

      if (formattedTransactionData && formattedTransactionData.length > 0) {
        const responseMode = resolvedRequest.authorizationRequest.response_mode
        const transactionSelections = selectedTransactionData.map((entry) => ({ ...entry }))

        formattedTransactionData.forEach((entry, index) => {
          let selected = transactionSelections[index]?.credentialId

          if (!selected) return

          if (
            entry.type !== 'qes_authorization' &&
            transactionSelections[index] &&
            !transactionSelections[index]?.additionalPayload
          ) {
            transactionSelections[index] = {
              credentialId: selected,
              additionalPayload: getAdditionalPayload(responseMode),
            }
          }

          const submission = entry.formattedSubmissions.find(
            (s) => s.isSatisfied && s.credentials.some((c) => c.credential.id === selected)
          )

          if (!submission) {
            throw new Error('Selected credential ids should always have a submission')
          }

          const selectedRecordId = stripCredentialPrefix(selected)
          if (
            Object.hasOwn(selectedCredentials, submission.inputDescriptorId) &&
            selectedCredentials[submission.inputDescriptorId] !== selectedRecordId
          ) {
            throw new Error('Cannot select distinct credential ids for inputDescriptor ids')
          }

          selectedCredentials[submission.inputDescriptorId] = selectedRecordId
          transactionSelections[index].credentialId = submission.inputDescriptorId
        })

        if (transactionSelections.some((entry) => typeof entry.credentialId !== 'string')) {
          throw new Error('No credentials selected for transaction data')
        }

        acceptTransactionData = transactionSelections as Array<{ credentialId: string; additionalPayload?: object }>
      }

      await sendResponseForDcApi({
        agent,
        dcRequest: request,
        resolvedRequest,
        acceptTransactionData,
        selectedCredentials,
      })
    } catch (error) {
      agent.config.logger.error('Could not share response', { error })

      if (error instanceof BiometricAuthenticationCancelledError) {
        sendErrorResponseForDcApi('Biometric authentication cancelled')
        return
      }

      sendErrorResponseForDcApi('Unable to share credentials')
    } finally {
      // no-op: sending response should close the flow
    }
  }, [
    agent,
    formattedTransactionData,
    request,
    resolvedRequest,
    selectedTransactionData,
  ])

  const transactionSlides: SlideStep[] = (formattedTransactionData ?? []).flatMap((entry, index) => {
    const progress = ((index + 1) / ((formattedTransactionData?.length ?? 0) + 1)) * 100

    if (entry.type === 'qes_authorization') {
      const qesEntry = entry as QesTransactionDataEntry

      return [
        {
          step: `signing-${index}`,
          progress,
          screen: (
            <SigningSlide
              key={`signing-${index}`}
              qtsp={qesEntry.qtsp}
              documentNames={qesEntry.documentNames}
              onCredentialSelect={(credentialId) =>
                onTransactionDataSelect(index, { credentialId, additionalPayload: undefined })
              }
              selectedCredentialId={selectedTransactionData?.[index]?.credentialId}
              possibleCredentialIds={qesEntry.formattedSubmissions.flatMap((s) =>
                s.isSatisfied ? s.credentials.map((c) => c.credential.id) : []
              )}
            />
          ),
        },
      ]
    }

    if (entry.type === 'urn:eudi:sca:payment:1') return []

    const ts12Entry = entry as Ts12TransactionDataEntry

    return [
      {
        step: `ts12-${index}`,
        progress,
        screen: (
          <Ts12TransactionSlide
            key={`ts12-${index}`}
            entry={ts12Entry}
            onCredentialSelect={(credentialId, additionalPayload) =>
              onTransactionDataSelect(index, { credentialId, additionalPayload })
            }
            selectedCredentialId={selectedTransactionData?.[index]?.credentialId}
            responseMode={resolvedRequest?.authorizationRequest.response_mode}
          />
        ),
      },
    ]
  })

  const SendingSlide = () => {
    const startedRef = useRef(false)

    useEffect(() => {
      if (startedRef.current) return
      startedRef.current = true
      void onProofAccept()
    }, [onProofAccept])

    return (
      <YStack fg={1} jc="center" ai="center" gap="$4">
        <Spinner />
        <Paragraph>
          {t({
            id: 'sharing.inProgress',
            message: 'Sharing information',
            comment: 'Shown while sharing data for the digital credentials API flow',
          })}
        </Paragraph>
      </YStack>
    )
  }

  if (!agent) {
    return (
      <YStack
        borderTopLeftRadius="$8"
        borderTopRightRadius="$8"
        backgroundColor="white"
        gap="$5"
        p="$4"
        paddingBottom={insets.bottom ?? '$6'}
      >
        <YStack>
          <WalletPinPromptHeader
            title={t(commonMessages.enterPinToShareData)}
            annotation={request.origin}
            headerAction={<IconContainer aria-label="Cancel" icon={<HeroIcons.X />} onPress={onDecline} />}
          />
        </YStack>

        <Stack pt="$5">
          <WalletPinPromptInput
            onPinComplete={unlockUsingPin}
            isLoading={isUnlocking}
            inputRef={pinRef}
            onBiometricsTap={
              showBiometricUnlockAction
                ? () => {
                    hasAttemptedAutoBiometricsRef.current = true
                    setShouldPromptBiometrics(false)
                    void unlockUsingBiometrics()
                  }
                : undefined
            }
            biometricsType={biometricsType ?? 'fingerprint'}
          />
        </Stack>
      </YStack>
    )
  }

  if (isResolving || !resolvedRequest) {
    return (
      <YStack fg={1} jc="center" ai="center" gap="$4">
        <Spinner />
        <Paragraph>
          {t({
            id: 'loadingRequestSlide.description',
            message: 'Fetching information',
            comment: 'Shown while waiting for data to be received from backend',
          })}
        </Paragraph>
      </YStack>
    )
  }

  return (
    <AgentProvider agent={agent}>
      <SlideWizard
        steps={[
          ...transactionSlides,
          {
            step: 'send',
            progress: 100,
            screen: <SendingSlide />,
          },
        ]}
        onCancel={onDecline}
      />
    </AgentProvider>
  )
}
