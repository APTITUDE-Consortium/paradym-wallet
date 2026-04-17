import { useToastController } from '@package/ui'
import { InvitationQrTypes } from '@paradym/wallet-sdk'
import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { type CredentialDataHandlerOptions, useCredentialDataHandler } from '../hooks'

interface DeeplinkHandlerProps {
  children: ReactNode
  credentialDataHandlerOptions?: CredentialDataHandlerOptions
  handleInitialUrl?: boolean
  resetNavigation?: boolean
}

export const deeplinkSchemes = Object.values(InvitationQrTypes)

// TODO: use https://docs.expo.dev/router/advanced/native-intent/
export const DeeplinkHandler = ({
  children,
  credentialDataHandlerOptions,
  handleInitialUrl = true,
  resetNavigation = true,
}: DeeplinkHandlerProps) => {
  const { handleCredentialData } = useCredentialDataHandler()
  const toast = useToastController()
  const router = useRouter()

  // TODO: I'm not sure if we need this? Or whether an useEffect without any deps is enough?
  const [hasHandledInitialUrl, setHasHandledInitialUrl] = useState(false)

  const handleUrl = useCallback(
    (url: string) => {
      const isRecognizedDeeplink = deeplinkSchemes.some((scheme) => url.startsWith(scheme))

      if (resetNavigation && isRecognizedDeeplink) {
        router.dismissAll()
      }

      // Ignore deeplinks that don't start with the schemes for credentials
      if (isRecognizedDeeplink) {
        void handleCredentialData(url, credentialDataHandlerOptions).then((result) => {
          if (!result.success) {
            toast.show(result.message, { customData: { preset: 'danger' } })
          }
        })
      }
    },
    [resetNavigation, router, toast.show, handleCredentialData, credentialDataHandlerOptions]
  )

  // NOTE: we use getInitialURL and the event listener over useURL as we don't know
  // using that method whether the same url is opened multiple times. As we need to make
  // sure to handle ALL incoming deeplinks (to prevent default expo-router behaviour) we
  // handle them ourselves. On startup getInitialUrl will be called once.
  useEffect(() => {
    if (!handleInitialUrl || hasHandledInitialUrl) return
    void Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url)
      setHasHandledInitialUrl(true)
    })
  }, [handleInitialUrl, hasHandledInitialUrl, handleUrl])

  useEffect(() => {
    const eventListener = Linking.addEventListener('url', (event) => handleUrl(event.url))
    return () => eventListener.remove()
  }, [handleUrl])

  return <>{children}</>
}
