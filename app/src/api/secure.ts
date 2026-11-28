import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

/**
 * Vérifie que c'est bien le propriétaire du téléphone (Face ID, Touch ID, empreinte ou code)
 * avant une action sensible comme déverrouiller le PC. Renvoie un message d'erreur, ou null si c'est bon.
 */
export async function confirmOwner(reason: string): Promise<string | null> {
  if (Platform.OS === 'web') return null; // aperçu de développement
  const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
  const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => LocalAuthentication.SecurityLevel.NONE);
  if (!hardware && level === LocalAuthentication.SecurityLevel.NONE) {
    return 'Active un code de verrouillage sur ton téléphone pour pouvoir déverrouiller le PC.';
  }
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Annuler',
    disableDeviceFallback: false, // le code du téléphone reste possible si Face ID échoue
    fallbackLabel: 'Utiliser le code',
  });
  if (res.success) return null;
  if (res.error === 'user_cancel' || res.error === 'system_cancel' || res.error === 'app_cancel') return 'Déverrouillage annulé.';
  if (!enrolled && res.error === 'not_enrolled') return 'Active Face ID ou un code sur ton téléphone pour déverrouiller le PC.';
  return 'Identité non confirmée : le PC reste verrouillé.';
}
