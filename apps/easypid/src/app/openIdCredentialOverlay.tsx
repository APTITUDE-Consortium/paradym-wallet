import { FunkeCredentialNotificationScreen } from '@easypid/features/receive/FunkeOpenIdCredentialNotificationScreen'
import { OverlayRouteGate } from '@easypid/features/navigation/OverlayRouteGate'

export default function OpenIdCredentialOverlayScreen() {
  return (
    <OverlayRouteGate>
      <FunkeCredentialNotificationScreen />
    </OverlayRouteGate>
  )
}
