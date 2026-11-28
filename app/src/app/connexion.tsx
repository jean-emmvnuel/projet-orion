import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, type TextInputInstance, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/api/session';
import { OrionMark, PressableScale, Segmented, tap } from '@/components/ui';
import { font, makeStyles, radius, space, useTheme } from '@/theme';

/** Connexion / création du compte ORION, avec l'adresse du Core en réglage avancé. */
export default function ConnexionScreen() {
  const { c, t } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(session.coreUrl);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password || (mode === 'register' && !username.trim())) {
      setError('Remplis tous les champs.');
      return;
    }
    setBusy(true);
    try {
      if (server.trim() !== session.coreUrl) await session.setCoreUrl(server);
      if (mode === 'login') await session.login(email.trim().toLowerCase(), password);
      else await session.register(username.trim(), email.trim().toLowerCase(), password);
      tap('success');
    } catch (e) {
      tap('warning');
      setError(e instanceof Error ? e.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      {/* Le champ actif reste toujours visible au-dessus du clavier, avec une marge pour le bouton. */}
      <KeyboardAwareScrollView
        bottomOffset={space.xxxl + space.xl}
        contentContainerStyle={[s.content, { paddingTop: insets.top + space.xxxl, paddingBottom: insets.bottom + space.xxl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.brand}>
          <OrionMark size={56} />
          <Text style={[t.largeTitle, { marginTop: space.lg }]}>ORION</Text>
          <Text style={[t.subhead, { marginTop: space.xs, textAlign: 'center' }]}>Pilote tes PC depuis ton téléphone.</Text>
        </View>

        <Segmented
          label="Connexion ou inscription"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
          options={[
            { value: 'login', label: 'Se connecter' },
            { value: 'register', label: 'Créer un compte' },
          ]}
        />

        <View style={s.form}>
          {mode === 'register' ? (
            <TextInput value={username} onChangeText={setUsername} placeholder="Prénom ou pseudo" placeholderTextColor={c.textFaint} style={s.input} autoComplete="name" textContentType="name" accessibilityLabel="Prénom ou pseudo" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => emailRef.current?.focus()} />
          ) : null}
          <TextInput ref={emailRef} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()} value={email} onChangeText={setEmail} placeholder="E-mail" placeholderTextColor={c.textFaint} style={s.input} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" accessibilityLabel="E-mail" />
          <TextInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            placeholder="Mot de passe"
            placeholderTextColor={c.textFaint}
            style={s.input}
            secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            textContentType={mode === 'login' ? 'password' : 'newPassword'}
            onSubmitEditing={submit}
            returnKeyType="go"
            accessibilityLabel="Mot de passe"
          />
          {mode === 'register' ? <Text style={t.footnote}>8 caractères minimum, avec une majuscule, une minuscule, un chiffre et un caractère spécial.</Text> : null}
        </View>

        {error ? (
          <View style={s.error} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={16} color={c.danger} />
            <Text style={[t.footnote, { color: c.danger, flex: 1, marginLeft: space.sm }]}>{error}</Text>
          </View>
        ) : null}

        <PressableScale onPress={submit} disabled={busy} accessibilityRole="button" style={[s.primary, busy && { opacity: 0.7 }]} haptic={false}>
          {busy ? <ActivityIndicator color={c.onViolet} /> : <Text style={s.primaryText}>{mode === 'login' ? 'Se connecter' : 'Créer mon compte'}</Text>}
        </PressableScale>

        <Pressable onPress={() => setShowServer((v) => !v)} style={s.serverToggle} accessibilityRole="button">
          <Ionicons name="server-outline" size={14} color={c.textMuted} />
          <Text style={[t.footnote, { marginLeft: 6 }]} numberOfLines={1}>
            Serveur ORION Core : {session.coreUrl.replace(/^https?:\/\//, '')}
          </Text>
          <Ionicons name={showServer ? 'chevron-up' : 'chevron-down'} size={14} color={c.textMuted} style={{ marginLeft: 4 }} />
        </Pressable>
        {showServer ? (
          <TextInput value={server} onChangeText={setServer} placeholder="https://orion-core.example.com" placeholderTextColor={c.textFaint} style={s.input} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Adresse du serveur ORION Core" />
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: space.xl, width: '100%', maxWidth: 460, alignSelf: 'center', gap: space.lg },
  brand: { alignItems: 'center', marginBottom: space.lg },
  form: { gap: space.sm },
  input: { height: 52, borderRadius: radius.md, backgroundColor: c.surface, paddingHorizontal: space.lg, fontFamily: font.regular, fontSize: 16, color: c.text, borderWidth: 0.5, borderColor: c.separator },
  error: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: c.dangerSoft, borderRadius: radius.md, padding: space.md },
  primary: { height: 54, borderRadius: radius.pill, backgroundColor: c.violet, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: font.semibold, fontSize: 17, color: c.onViolet },
  serverToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44 },
}));
