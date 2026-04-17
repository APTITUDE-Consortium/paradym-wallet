import { FunkeOpenIdPresentationNotificationScreen } from '@easypid/features/share/FunkeOpenIdPresentationNotificationScreen'
import { OverlayRouteGate } from '@easypid/features/navigation/OverlayRouteGate'

export default function OpenIdPresentationOverlayScreen() {
  return (
    <OverlayRouteGate>
      <FunkeOpenIdPresentationNotificationScreen />
    </OverlayRouteGate>
  )
}
