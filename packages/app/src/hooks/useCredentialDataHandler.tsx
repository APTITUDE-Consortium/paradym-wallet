import { useLingui } from '@lingui/react/macro'
import { commonMessages } from '@package/translations'
import { type InvitationType, parseInvitationUrl } from '@paradym/wallet-sdk'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'

export interface CredentialDataHandlerOptions {
  allowedInvitationTypes?: Array<InvitationType>
  routeMethod?: 'push' | 'replace'
  source?: string
}

export const useCredentialDataHandler = () => {
  const { push, replace } = useRouter()
  const { t } = useLingui()

  const handleCredentialData = async (
    dataUrl: string,
    options?: CredentialDataHandlerOptions
  ): Promise<
    | { success: true }
    | {
        success: false
        error: 'invitation_type_not_allowed' | 'invitation_not_found'
        message: string
      }
  > => {
    try {
      const invitationData = await parseInvitationUrl(dataUrl)
      const routeMethodName = options?.routeMethod ?? 'push'
      const routeMethod = routeMethodName === 'push' ? push : replace

      if (options?.allowedInvitationTypes && !options.allowedInvitationTypes.includes(invitationData.type)) {
        return {
          success: false,
          error: 'invitation_type_not_allowed',
          message: t(commonMessages.invitationTypeNotAllowed),
        } as const
      }

      if (invitationData.type === 'openid-credential-offer') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        routeMethod({
          pathname: options?.source === 'deeplink' ? '/incomingDeeplink' : '/notifications/openIdCredential',
          params:
            options?.source === 'deeplink'
              ? {
                  kind: 'openid-credential-offer',
                  source: options.source,
                  uri: encodeURIComponent(invitationData.data),
                }
              : {
                  uri: encodeURIComponent(invitationData.data),
                  source: options?.source,
                },
        })
        return { success: true } as const
      }

      if (invitationData.type === 'openid-authorization-request') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        routeMethod({
          pathname:
            options?.source === 'deeplink' ? '/incomingDeeplink' : '/notifications/openIdPresentation',
          params:
            options?.source === 'deeplink'
              ? {
                  kind: 'openid-authorization-request',
                  source: options.source,
                  uri: encodeURIComponent(invitationData.data),
                }
              : {
                  uri: encodeURIComponent(invitationData.data),
                  source: options?.source,
                },
        })
        return { success: true } as const
      }

      if (invitationData.type === 'didcomm') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        routeMethod({
          pathname: '/notifications/didcomm',
          params: {
            invitationUrl: encodeURIComponent(invitationData.data),
            source: options?.source,
          },
        })
        return { success: true } as const
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      return {
        success: false,
        error: 'invitation_type_not_allowed',
        message: `Could not find handler for type: '${invitationData.type}'`,
      }
    } catch (_e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      return {
        success: false,
        error: 'invitation_not_found',
        message: t(commonMessages.unableToRetrieveInvitation),
      }
    }
  }

  return {
    handleCredentialData,
  }
}
