import { useBiometricsType } from '@easypid/hooks/useBiometricsType'
import type { OverAskingResponse } from '@easypid/use-cases/OverAskingApi'
import { useLingui } from '@lingui/react/macro'
import type { PinDotsInputRef } from '@package/app'
import { commonMessages } from '@package/translations'
import { formatRelativeDate } from '@package/utils'
import {
  Button,
  FlowSurface,
  Heading,
  Paragraph,
  ScrollView,
  useToastController,
  XStack,
  YStack,
} from '@package/ui'
import type {
  DisplayImage,
  FormattedSubmission,
  FormattedSubmissionEntrySatisfied,
  ResolveCredentialRequestStage,
  FormattedTransactionData,
  TrustedEntity,
  TrustMechanism,
} from '@paradym/wallet-sdk'
import {
  ParadymWalletAuthenticationInvalidPinError,
  ParadymWalletBiometricAuthenticationCancelledError,
  useActivities,
  useCanUseBiometryBackedWalletKey,
  useIsBiometricsEnabled,
  useParadym,
} from '@paradym/wallet-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ConsentAuthSection,
  ConsentErrorState,
  ConsentLoadingSection,
  ConsentPartyHeader,
  ConsentSection,
} from '../consent/ConsentBlocks'
import { getPresentationLoadingCopy } from '../consent/loadingStageCopy'
import type { SelectedCredentialsMap } from './components/CredentialSelectionSection'
import { CredentialSelectionSection } from './components/CredentialSelectionSection'
import { RequestedAttributesSection } from './components/RequestedAttributesSection'
import { RequestPurposeSection } from './components/RequestPurposeSection'

interface FunkePresentationNotificationScreenProps {
  verifierName?: string
  entityId?: string
  logo?: DisplayImage
  overAskingResponse?: OverAskingResponse
  trustMechanism?: TrustMechanism
  trustedEntities?: Array<TrustedEntity>
  submission?: FormattedSubmission
  surface?: 'fullscreen' | 'sheet'
  usePin: boolean
  isAccepting: boolean
  transaction?: FormattedTransactionData
  onAccept: (options: {
    selectedCredentials: SelectedCredentialsMap
    pin?: string
    didUseBiometrics?: boolean
  }) => Promise<{ completed: boolean; didOpenExternalRedirect?: boolean }>
  onDecline: () => void
  onCancel: () => void
  onComplete: (options?: { didOpenExternalRedirect?: boolean }) => void
  errorReason?: string
  loadingStage?: ResolveCredentialRequestStage
}

export function FunkePresentationNotificationScreen({
  verifierName,
  entityId,
  logo,
  surface = 'fullscreen',
  usePin,
  onAccept,
  onCancel,
  onDecline,
  submission,
  onComplete,
  overAskingResponse,
  trustMechanism,
  trustedEntities,
  isAccepting,
  transaction,
  errorReason,
  loadingStage,
}: FunkePresentationNotificationScreenProps) {
  const { t } = useLingui()
  const toast = useToastController()
  const paradym = useParadym()
  const [isBiometricsEnabled] = useIsBiometricsEnabled()
  const canUseBiometryBackedWalletKey = useCanUseBiometryBackedWalletKey()
  const biometricsType = useBiometricsType()
  const [isProcessing, setIsProcessing] = useState(false)
  const pinRef = useRef<PinDotsInputRef>(null)
  const [selectedCredentials, setSelectedCredentials] = useState<SelectedCredentialsMap>({})
  const [step, setStep] = useState<'review' | 'auth' | 'sending'>('review')
  const hasAttemptedAutoBiometricsRef = useRef(false)
  const isOverlay = surface === 'sheet'
  const { activities } = useActivities({ filters: entityId ? { entityId } : undefined })
  const needsWalletAuth = usePin
  const canRequestBiometrics =
    step === 'auth' &&
    needsWalletAuth &&
    paradym.state === 'locked' &&
    paradym.canTryUnlockingUsingBiometrics &&
    isBiometricsEnabled &&
    canUseBiometryBackedWalletKey

  const satisfiedEntries = useMemo(
    () => submission?.entries.filter((entry): entry is FormattedSubmissionEntrySatisfied => entry.isSatisfied) ?? [],
    [submission]
  )

  useEffect(() => {
    if (!submission) return

    pinRef.current?.clear()
    setStep('review')

    setSelectedCredentials((current) => {
      const next: SelectedCredentialsMap = {}
      for (const entry of satisfiedEntries) {
        if (entry.isOptional) continue

        const currentSelection = current[entry.inputDescriptorId]
        const matchingSelection = entry.credentials.find((credential) => credential.credential.id === currentSelection)

        next[entry.inputDescriptorId] = matchingSelection?.credential.id ?? entry.credentials[0].credential.id
      }
      return next
    })
  }, [submission, satisfiedEntries])

  const submitAccept = useCallback(
    async ({
      pin,
      didUseBiometrics,
      skipBusyGuard = false,
    }: { pin?: string; didUseBiometrics?: boolean; skipBusyGuard?: boolean } = {}) => {
      if (!submission || (!skipBusyGuard && (isProcessing || isAccepting))) return
      if (!submission.areAllSatisfied) {
        toast.show(
          t({
            id: 'presentation.noCredentialsSelected',
            message: 'No credentials selected',
            comment: 'Shown when the user cannot continue without a credential',
          }),
          { customData: { preset: 'warning' } }
        )
        return
      }

      const previousStep = step
      setIsProcessing(true)
      setStep('sending')
      try {
        const result = await onAccept({
          selectedCredentials,
          pin: usePin && !didUseBiometrics ? pin : undefined,
          didUseBiometrics,
        })
        if (!result.completed) {
          setStep(previousStep)
          return
        }

        await onComplete(result.didOpenExternalRedirect ? { didOpenExternalRedirect: true } : undefined)
      } catch (error) {
        if (error instanceof ParadymWalletAuthenticationInvalidPinError) {
          setStep('auth')
          pinRef.current?.clear()
          pinRef.current?.shake()
          toast.show(
            t({
              id: 'presentation.invalidPin',
              message: 'Invalid PIN entered',
              comment: 'Shown when the user enters the wrong PIN',
            }),
            { customData: { preset: 'danger' } }
          )
          return
        }

        setStep(previousStep)
        throw error
      } finally {
        setIsProcessing(false)
      }
    },
    [isAccepting, isProcessing, onAccept, onComplete, pinRef, selectedCredentials, step, submission, t, toast, usePin]
  )

  const runSubmitAccept = useCallback(
    (options?: { pin?: string; didUseBiometrics?: boolean; skipBusyGuard?: boolean }) => {
      void submitAccept(options).catch((error) => {
        console.error('Unhandled error while submitting presentation consent', error)
      })
    },
    [submitAccept]
  )

  const onBiometricsTap = useCallback(() => {
    if (!canRequestBiometrics) return
    setIsProcessing(true)
    void paradym
      .tryUnlockingUsingBiometrics()
      .then(async () => {
        await submitAccept({ didUseBiometrics: true, skipBusyGuard: true })
      })
      .catch((error) => {
        if (error instanceof ParadymWalletBiometricAuthenticationCancelledError) return

        toast.show(
          t({
            id: 'presentation.biometricFailed',
            message: 'Biometric authentication failed',
            comment: 'Shown when biometric authentication cannot continue',
          }),
          { customData: { preset: 'warning' } }
        )
      })
      .finally(() => {
        setIsProcessing(false)
      })
  }, [canRequestBiometrics, paradym, submitAccept, t, toast])

  useEffect(() => {
    if (step !== 'auth') {
      hasAttemptedAutoBiometricsRef.current = false
      return
    }

    if (!canRequestBiometrics || hasAttemptedAutoBiometricsRef.current || isProcessing || isAccepting) return

    hasAttemptedAutoBiometricsRef.current = true
    onBiometricsTap()
  }, [canRequestBiometrics, isAccepting, isProcessing, onBiometricsTap, step])

  const goBackToReview = useCallback(() => {
    pinRef.current?.clear()
    setStep('review')
  }, [pinRef])

  const handleReviewAccept = useCallback(() => {
    if (!submission || isProcessing || isAccepting) return

    if (!submission.areAllSatisfied) {
      toast.show(
        t({
          id: 'presentation.noCredentialsSelected',
          message: 'No credentials selected',
          comment: 'Shown when the user cannot continue without a credential',
        }),
        { customData: { preset: 'warning' } }
      )
      return
    }

    if (!needsWalletAuth) {
      runSubmitAccept()
      return
    }

    setStep('auth')
  }, [isAccepting, isProcessing, needsWalletAuth, runSubmitAccept, submission, t, toast])

  if (errorReason) {
    return (
      <FlowSurface
        surface={surface}
        sheetVariant={isOverlay ? 'docked' : undefined}
        footer={<Button.Solid onPress={onCancel}>{t(commonMessages.close)}</Button.Solid>}
      >
        <YStack flex={1} gap="$6" justifyContent="center">
          <ConsentErrorState
            title={t({
              id: 'presentation.errorTitle',
              message: 'Something went wrong',
              comment: 'Title shown when the consent flow cannot continue',
            })}
            description={errorReason}
          />
        </YStack>
      </FlowSurface>
    )
  }

  const verifierLabel = verifierName ?? t(commonMessages.unknownOrganization)
  const unverifiedLabel = !trustMechanism
    ? t({
        id: 'verifyPartySlide.organizationNotVerifiedHeading',
        message: 'Organization not verified',
        comment: 'Badge shown when the relying party or issuer could not be verified',
      })
    : undefined
  const trustedEntitiesWithoutSelf =
    trustedEntities?.filter((trustedEntity) => trustedEntity.entityId !== entityId) ?? []
  const lastInteractionDate = entityId ? activities?.[0]?.date : undefined
  const trustContext =
    trustedEntitiesWithoutSelf.length > 1
      ? {
          title: t({
            id: 'verifyPartySlide.recognizedOrganizationTitle',
            message: 'Recognized organization',
          }),
          description: t({
            id: 'verifyPartySlide.approvedByMultipleOrganizations',
            message: `Approved by ${trustedEntitiesWithoutSelf.length} organizations`,
          }),
        }
      : trustedEntitiesWithoutSelf.length === 1
        ? {
            title: t({
              id: 'verifyPartySlide.recognizedOrganizationTitle',
              message: 'Recognized organization',
            }),
            description: t({
              id: 'verifyPartySlide.approvedByOneOrganization',
              message: 'Approved by one organization',
            }),
          }
        : undefined
  const interactionContext = lastInteractionDate
    ? {
        title: t({
          id: 'verifyPartySlide.hasPreviousInteractionsTitle',
          message: 'Previous interactions',
        }),
        description: t({
          id: 'verifyPartySlide.hasPreviousInteractionsDescription',
          message: `Last interaction: ${formatRelativeDate(new Date(lastInteractionDate))}`,
        }),
      }
    : entityId
      ? {
          title: t({
            id: 'verifyPartySlide.hasNoPreviousInteractionsTitle',
            message: 'First time interaction',
          }),
          description: t({
            id: 'verifyPartySlide.hasNoPreviousInteractionsDescription',
            message: 'No previous interactions found',
          }),
        }
      : undefined
  const footer =
    step === 'sending' ? null : step === 'auth' ? (
      <Button.Outline onPress={goBackToReview} disabled={isProcessing || isAccepting}>
        {t(commonMessages.backButton)}
      </Button.Outline>
    ) : (
      <XStack gap="$3">
        <Button.Outline flex={1} onPress={onDecline} disabled={isProcessing || isAccepting}>
          {t(commonMessages.stop)}
        </Button.Outline>
        <Button.Solid
          flex={1}
          onPress={handleReviewAccept}
          disabled={isProcessing || isAccepting || !submission || !submission.areAllSatisfied}
        >
          {transaction?.type === 'qes_authorization'
            ? t({
                id: 'presentation.signAndShare',
                message: 'Sign & share',
                comment: 'Button label when the request includes signing',
              })
            : t(commonMessages.acceptButton)}
        </Button.Solid>
      </XStack>
    )

  const loadingCopy = getPresentationLoadingCopy(t, loadingStage)

  return (
    <FlowSurface
      surface={surface}
      sheetVariant={isOverlay ? 'docked' : undefined}
      logo={isOverlay ? logo : undefined}
      footer={footer}
      header={
        <YStack gap="$3">
          <ConsentPartyHeader
            hideLogo={isOverlay}
            logo={logo}
            title={
              step === 'auth'
                ? t({
                    id: 'presentation.pinHeading',
                    message: 'Enter your PIN',
                    comment: 'Heading shown on the PIN confirmation screen',
                  })
                : step === 'sending'
                  ? t({
                      id: 'presentation.sendingTitle',
                      message: 'Sending response',
                      comment: 'Heading shown while the wallet is sending the presentation response',
                    })
                : t({
                    id: 'presentation.reviewTitle',
                    message: 'Choose what to share',
                    comment: 'Title shown at the top of the consent flow',
                  })
            }
            subtitle={verifierLabel}
            badgeLabel={unverifiedLabel}
          />
        </YStack>
      }
    >
      <ScrollView contentContainerStyle={{ gap: '$6', flexGrow: 1 }} scrollIndicatorInsets={{ right: 1 }}>
        {!submission ? (
          <ConsentLoadingSection
            title={loadingCopy.title}
            description={loadingCopy.description}
          />
        ) : step === 'sending' ? (
          <ConsentLoadingSection
            title={t({
              id: 'presentation.sendingTitle',
              message: 'Sending response',
              comment: 'Title shown while the wallet is sending the presentation response',
            })}
            description={t({
              id: 'presentation.sendingDescription',
              message: 'Please wait while your wallet sends the response.',
              comment: 'Description shown while the wallet sends the presentation response',
            })}
          />
        ) : step === 'auth' ? (
          isProcessing ? (
            <ConsentLoadingSection
              title={t({
                id: 'authenticate.loadingTitle',
                message: 'Please wait',
                comment: 'Title shown while the wallet finishes unlocking after successful authentication',
              })}
              description={t({
                id: 'authenticate.loadingDescription',
                message: 'Unlocking your wallet.',
                comment: 'Description shown while the wallet finishes unlocking after successful authentication',
              })}
            />
          ) : (
            <ConsentAuthSection
              title={t({
                id: 'presentation.pinHeading',
                message: 'Enter your PIN',
                comment: 'Heading shown on the PIN confirmation screen',
              })}
              description={t({
                id: 'presentation.pinDescription',
                message: 'Use your app PIN or biometrics to confirm the request.',
                comment: 'Description shown on the PIN confirmation screen',
              })}
              summaryLabel={t({
                id: 'presentation.selectedCredentialCount',
                message: 'Credentials selected',
                comment: 'Summary label shown before the PIN step',
              })}
              summaryValue={Object.keys(selectedCredentials).length.toString()}
              pinRef={pinRef}
              onPinComplete={(value) => {
                runSubmitAccept({ pin: value })
              }}
              onBiometricsTap={canRequestBiometrics ? onBiometricsTap : undefined}
              biometricsType={biometricsType ?? 'fingerprint'}
              isLoading={isProcessing}
            />
          )
        ) : (
          <YStack gap="$6">
            {trustContext ? <ConsentSection title={trustContext.title} description={trustContext.description} /> : null}
            {interactionContext ? (
              <ConsentSection title={interactionContext.title} description={interactionContext.description} />
            ) : null}
            {transaction?.type === 'qes_authorization' ? (
              <ConsentSection
                eyebrow={t({
                  id: 'presentation.signingHeading',
                  message: 'Signing request',
                  comment: 'Heading for the signing-specific consent details',
                })}
                title={transaction.documentName ?? t(commonMessages.documentSigned)}
                description={
                  transaction.qtsp.name ??
                  transaction.qtsp.entityId ??
                  t({
                    id: 'presentation.signingDescription',
                    message: 'This request will create a digital signature.',
                    comment: 'Description shown for QES authorization requests',
                  })
                }
              />
            ) : null}

            <RequestPurposeSection
              purpose={submission.purpose ?? verifierLabel}
              overAskingResponse={overAskingResponse}
              logo={logo}
            />

            {overAskingResponse?.validRequest === 'no' ? (
              <ConsentSection
                tone="danger"
                title={t({
                  id: 'presentation.overaskingTitle',
                  message: 'Request needs a closer look',
                  comment: 'Warning shown when the purpose and requested data do not line up',
                })}
                description={
                  overAskingResponse.reason ??
                  t({
                    id: 'presentation.overaskingDescription',
                    message: 'The stated purpose does not match the requested data.',
                    comment: 'Warning shown when the request may be asking for too much data',
                  })
                }
              />
            ) : null}

            <CredentialSelectionSection
              submission={submission}
              selectedCredentials={selectedCredentials}
              onSelect={(entryId, credentialId) =>
                setSelectedCredentials((current) => ({ ...current, [entryId]: credentialId }))
              }
            />
            <RequestedAttributesSection submission={submission} selectedCredentials={selectedCredentials} />
          </YStack>
        )}
      </ScrollView>
    </FlowSurface>
  )
}
