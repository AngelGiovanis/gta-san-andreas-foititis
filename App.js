/**
 * GTA: SAN ANDREAS FOITITIS
 * -------------------------
 * Personal university utility dashboard for NKUA DIT, styled after the
 * Grand Theft Auto: San Andreas HUD.
 *
 *  - STATS tab: ECTS tracker towards the 240 ECTS degree target, with a
 *    Health/Armor-bar style progress HUD and a "MISSION PASSED!" overlay
 *    animation every time a course is logged.
 *  - MAP tab:  dark, radar-styled native map of Athens. Long-press to drop
 *    categorized waypoints (coffee / study / eats / skate).
 *
 *  All data persists on-device via AsyncStorage.
 *  Single-file app for easy testing in Expo Go.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker } from 'react-native-maps';

/* ------------------------------------------------------------------ */
/*  CONSTANTS                                                          */
/* ------------------------------------------------------------------ */

const TARGET_ECTS = 240;

const STORAGE_KEYS = {
  COURSES: '@gta_foititis_courses_v1',
  PINS: '@gta_foititis_pins_v1',
  BALANCE: '@gta_foititis_balance_v1',
};

// Centered on Athens — Syntagma-ish, wide enough to cover NKUA & the center.
const ATHENS_REGION = {
  latitude: 37.9755,
  longitude: 23.7348,
  latitudeDelta: 0.09,
  longitudeDelta: 0.09,
};

const CATEGORIES = [
  { id: 'coffee', label: 'CHEAP COFFEE', color: '#F5A623' },
  { id: 'study', label: 'STUDY SPOTS', color: '#4FC3F7' },
  { id: 'eats', label: 'HIGH-PROTEIN CHEAP EATS', color: '#FF5252' },
  { id: 'skate', label: 'SKATE / CRUISING ROUTES', color: '#7CFC5A' },
];

const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// San Andreas HUD palette.
const COLORS = {
  bg: '#070A06',
  panel: 'rgba(10, 14, 9, 0.92)',
  panelBorder: '#1C2418',
  groveGreen: '#5FD35F',
  neonGreen: '#7CFC5A',
  moneyGreen: '#9CE564',
  hudGold: '#E8C547',
  missionGold: '#DCBE6C',
  healthRed: '#B4191D',
  armorGrey: '#5C7A98',
  textDim: '#8A9384',
  white: '#F2F2E9',
  black: '#000000',
};

// Chunky, condensed system fonts — closest stand-in for Pricedown
// without bundling font assets.
const HUD_FONT = Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' });
const MISSION_FONT = Platform.select({ ios: 'Georgia-BoldItalic', android: 'serif' });

// Gritty in-game radar feel for Google-provider maps (Android / dev builds).
// On iOS with Apple Maps the MapView's userInterfaceStyle="dark" prop is
// used instead, since Apple Maps ignores customMapStyle.
const DARK_RADAR_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0d130c' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7a62' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#070a06' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#2a3325' }],
  },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#11200f' }, { visibility: 'on' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1d2419' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#0b0f09' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#7d8a72' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#33402b' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#141a10' }],
  },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#04090c' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3a4d56' }],
  },
];

const makeId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ */
/*  "MISSION PASSED!" OVERLAY                                          */
/* ------------------------------------------------------------------ */

function MissionPassedOverlay({ mission, onDone }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(2.6)).current;

  useEffect(() => {
    if (!mission) return;
    opacity.setValue(0);
    scale.setValue(2.6);
    const anim = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 320,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 5,
          tension: 70,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(1800),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }),
    ]);
    anim.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => anim.stop();
  }, [mission, opacity, scale, onDone]);

  if (!mission) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.missionOverlay, { opacity }]}
    >
      <Animated.View style={[styles.missionInner, { transform: [{ scale }] }]}>
        <Text style={styles.missionTitle}>{mission.title}</Text>
        <Text style={styles.missionRespect}>RESPECT +</Text>
        <Text style={styles.missionSub}>{mission.subtitle}</Text>
      </Animated.View>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/*  ECTS HUD BAR  (Health/Armor-bar style)                             */
/* ------------------------------------------------------------------ */

function HudBar({ totalEcts }) {
  const fillAnim = useRef(new Animated.Value(0)).current;
  const ratio = Math.min(1, totalEcts / TARGET_ECTS);

  useEffect(() => {
    // Width animation can't run on the native driver.
    Animated.timing(fillAnim, {
      toValue: ratio,
      duration: 650,
      useNativeDriver: false,
    }).start();
  }, [ratio, fillAnim]);

  const width = fillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.hudBarBlock}>
      <View style={styles.hudBarLabelRow}>
        <Text style={styles.hudBarLabel}>DEGREE PROGRESS</Text>
        <Text style={styles.hudBarValue}>
          {totalEcts} / {TARGET_ECTS} ECTS
        </Text>
      </View>
      <View style={styles.hudBarTrack}>
        <Animated.View style={[styles.hudBarFill, { width }]} />
        <View style={styles.hudBarGloss} pointerEvents="none" />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  COURSE ROW                                                         */
/* ------------------------------------------------------------------ */

const CourseRow = React.memo(function CourseRow({ course, onDelete }) {
  return (
    <View style={styles.courseRow}>
      <View style={styles.courseRowLeft}>
        <Text style={styles.courseName} numberOfLines={1}>
          {course.name}
        </Text>
        <Text style={styles.courseMeta}>MISSION COMPLETE</Text>
      </View>
      <Text style={styles.courseEcts}>+{course.ects}</Text>
      <TouchableOpacity
        style={styles.courseDeleteBtn}
        onPress={() => onDelete(course)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.courseDeleteText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  FINANCE PANEL                                                      */
/* ------------------------------------------------------------------ */

function BalanceModal({ visible, onClose, onSetBalance }) {
  const [text, setText] = useState('');

  const handleSet = useCallback(() => {
    const amount = parseFloat(text.replace(',', '.').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) {
      Alert.alert('MISSION FAILED', 'Enter a valid amount, fool.');
      return;
    }
    Keyboard.dismiss();
    onSetBalance(amount);
    setText('');
    onClose();
  }, [text, onSetBalance, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalPanel}>
          <Text style={styles.modalTitle}>UPDATE FUNDS</Text>
          <TextInput
            style={[styles.input, styles.modalInput]}
            placeholder="ENTER AMOUNT"
            placeholderTextColor={COLORS.textDim}
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSet}
          />
          <View style={styles.modalButtonRow}>
            <TouchableOpacity
              style={[styles.modalButton, styles.modalButtonCancel]}
              onPress={onClose}
            >
              <Text style={styles.modalButtonCancelText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, styles.modalButtonSave]}
              onPress={handleSet}
            >
              <Text style={styles.modalButtonSaveText}>CONFIRM</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  TRACKER SCREEN                                                     */
/* ------------------------------------------------------------------ */

function TrackerScreen({ courses, onAddCourse, onDeleteCourse, balance, onSetBalance }) {
  const [name, setName] = useState('');
  const [ectsText, setEctsText] = useState('');
  const [balanceVisible, setBalanceVisible] = useState(false);

  const totalEcts = useMemo(
    () => courses.reduce((sum, c) => sum + c.ects, 0),
    [courses]
  );
  const remaining = Math.max(0, TARGET_ECTS - totalEcts);
  const isComplete = remaining === 0;
  const minLessons = Math.ceil(remaining / 8);
  const maxLessons = Math.ceil(remaining / 6);

  const formattedBalance = balance.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const handleAdd = useCallback(() => {
    const trimmedName = name.trim();
    const ects = parseFloat(ectsText.replace(',', '.'));

    if (!trimmedName) {
      Alert.alert('MISSION FAILED', 'Give the course a name, fool.');
      return;
    }
    if (!Number.isFinite(ects) || ects <= 0 || ects > 60) {
      Alert.alert('MISSION FAILED', 'ECTS must be a number between 1 and 60.');
      return;
    }

    Keyboard.dismiss();
    onAddCourse(trimmedName, ects);
    setName('');
    setEctsText('');
  }, [name, ectsText, onAddCourse]);

  const handleDelete = useCallback(
    (course) => {
      Alert.alert(
        'WASTED',
        `Remove "${course.name}" (${course.ects} ECTS) from the record?`,
        [
          { text: 'CANCEL', style: 'cancel' },
          {
            text: 'REMOVE',
            style: 'destructive',
            onPress: () => onDeleteCourse(course.id),
          },
        ]
      );
    },
    [onDeleteCourse]
  );

  const renderCourse = useCallback(
    ({ item }) => <CourseRow course={item} onDelete={handleDelete} />,
    [handleDelete]
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      {/* HUD header */}
      <View style={styles.hudPanel}>
        <View style={styles.hudTopRow}>
          <View>
            <Text style={styles.hudTitle}>NKUA · DIT</Text>
            <Text style={styles.hudSubtitle}>INFORMATICS & TELECOM</Text>
          </View>
          <TouchableOpacity
            style={styles.hudBalanceTap}
            onPress={() => setBalanceVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.hudCashLabel}>CASH ▸</Text>
            <Text style={styles.hudMoney}>€{formattedBalance}</Text>
          </TouchableOpacity>
        </View>

        <HudBar totalEcts={totalEcts} />

        <View style={styles.hudFooterRow}>
          <Text style={styles.hudFooterStat}>
            <Text style={styles.hudFooterValue}>{remaining}</Text>
            {' ECTS LEFT'}
          </Text>
          {!isComplete ? (
            <>
              <Text style={styles.hudFooterDot}>·</Text>
              <Text style={styles.hudFooterStat}>
                {'~'}<Text style={styles.hudFooterValue}>{minLessons}–{maxLessons}</Text>
                {' COURSES'}
              </Text>
            </>
          ) : (
            <Text style={styles.hudCompleteTag}>· GAME COMPLETE ✓</Text>
          )}
        </View>
      </View>

      {/* New course input */}
      <View style={styles.inputSection}>
        <Text style={styles.inputSectionLabel}>▸ LOG A PASSED COURSE</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, styles.inputName]}
            placeholder="COURSE NAME"
            placeholderTextColor={COLORS.textDim}
            value={name}
            onChangeText={setName}
            returnKeyType="next"
            autoCapitalize="characters"
          />
          <TextInput
            style={[styles.input, styles.inputEcts]}
            placeholder="ECTS"
            placeholderTextColor={COLORS.textDim}
            value={ectsText}
            onChangeText={setEctsText}
            keyboardType="decimal-pad"
            returnKeyType="done"
            maxLength={4}
            onSubmitEditing={handleAdd}
          />
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={handleAdd}
          activeOpacity={0.8}
        >
          <Text style={styles.addButtonText}>COMPLETE MISSION</Text>
        </TouchableOpacity>
      </View>

      {/* Completed course list */}
      <FlatList
        data={courses}
        keyExtractor={(item) => item.id}
        renderItem={renderCourse}
        style={styles.courseList}
        contentContainerStyle={styles.courseListContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <Text style={styles.courseListHeader}>
            COMPLETED MISSIONS ({courses.length})
          </Text>
        }
        ListEmptyComponent={
          <Text style={styles.courseListEmpty}>
            NO MISSIONS COMPLETED YET.{'\n'}AH SHIT, HERE WE GO AGAIN.
          </Text>
        }
      />

      <BalanceModal
        visible={balanceVisible}
        onClose={() => setBalanceVisible(false)}
        onSetBalance={onSetBalance}
      />
    </KeyboardAvoidingView>
  );
}

/* ------------------------------------------------------------------ */
/*  RADAR BLIP MARKER                                                  */
/* ------------------------------------------------------------------ */

const PinMarker = React.memo(function PinMarker({ pin, onCalloutPress }) {
  const category = CATEGORY_BY_ID[pin.category] || CATEGORIES[0];
  return (
    <Marker
      coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
      title={pin.name}
      description={category.label}
      onCalloutPress={() => onCalloutPress(pin)}
      tracksViewChanges={false}
    >
      {/* Rotated square = classic SA radar blip */}
      <View style={[styles.blip, { backgroundColor: category.color }]} />
    </Marker>
  );
});

/* ------------------------------------------------------------------ */
/*  MAP SCREEN                                                         */
/* ------------------------------------------------------------------ */

function MapScreen({ pins, onAddPin, onDeletePin }) {
  // Coordinate of a long-press awaiting naming; null = modal closed.
  const [draftCoord, setDraftCoord] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState(CATEGORIES[0].id);

  const handleLongPress = useCallback((event) => {
    const { coordinate } = event.nativeEvent;
    setDraftName('');
    setDraftCategory(CATEGORIES[0].id);
    setDraftCoord(coordinate);
  }, []);

  const handleSavePin = useCallback(() => {
    if (!draftCoord) return;
    onAddPin({
      id: makeId(),
      name: draftName.trim() || 'UNKNOWN SPOT',
      category: draftCategory,
      latitude: draftCoord.latitude,
      longitude: draftCoord.longitude,
    });
    setDraftCoord(null);
  }, [draftCoord, draftName, draftCategory, onAddPin]);

  const handleCancelPin = useCallback(() => setDraftCoord(null), []);

  const handleCalloutPress = useCallback(
    (pin) => {
      const category = CATEGORY_BY_ID[pin.category] || CATEGORIES[0];
      Alert.alert(pin.name, category.label, [
        { text: 'KEEP', style: 'cancel' },
        {
          text: 'REMOVE WAYPOINT',
          style: 'destructive',
          onPress: () => onDeletePin(pin.id),
        },
      ]);
    },
    [onDeletePin]
  );

  return (
    <View style={styles.screen}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={ATHENS_REGION}
        customMapStyle={DARK_RADAR_MAP_STYLE}
        userInterfaceStyle="dark"
        onLongPress={handleLongPress}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        {pins.map((pin) => (
          <PinMarker key={pin.id} pin={pin} onCalloutPress={handleCalloutPress} />
        ))}
      </MapView>

      {/* Radar legend */}
      <View style={styles.legend} pointerEvents="none">
        <Text style={styles.legendTitle}>LOS ATHENS · RADAR</Text>
        {CATEGORIES.map((cat) => (
          <View key={cat.id} style={styles.legendRow}>
            <View style={[styles.blipSmall, { backgroundColor: cat.color }]} />
            <Text style={styles.legendLabel}>{cat.label}</Text>
          </View>
        ))}
        <Text style={styles.legendHint}>LONG-PRESS MAP TO DROP A WAYPOINT</Text>
      </View>

      {/* New waypoint modal */}
      <Modal
        visible={draftCoord !== null}
        transparent
        animationType="fade"
        onRequestClose={handleCancelPin}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalPanel}>
            <Text style={styles.modalTitle}>NEW WAYPOINT</Text>

            <TextInput
              style={[styles.input, styles.modalInput]}
              placeholder="NAME THE SPOT"
              placeholderTextColor={COLORS.textDim}
              value={draftName}
              onChangeText={setDraftName}
              autoFocus
              autoCapitalize="characters"
              returnKeyType="done"
              onSubmitEditing={handleSavePin}
            />

            <Text style={styles.modalSectionLabel}>CATEGORY</Text>
            {CATEGORIES.map((cat) => {
              const selected = cat.id === draftCategory;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryOption,
                    selected && {
                      borderColor: cat.color,
                      backgroundColor: 'rgba(255,255,255,0.06)',
                    },
                  ]}
                  onPress={() => setDraftCategory(cat.id)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[styles.blipSmall, { backgroundColor: cat.color }]}
                  />
                  <Text
                    style={[
                      styles.categoryOptionText,
                      selected && { color: cat.color },
                    ]}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={handleCancelPin}
              >
                <Text style={styles.modalButtonCancelText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={handleSavePin}
              >
                <Text style={styles.modalButtonSaveText}>DROP PIN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  ROOT APP                                                           */
/* ------------------------------------------------------------------ */

export default function App() {
  const [activeTab, setActiveTab] = useState('stats'); // 'stats' | 'map'
  const [courses, setCourses] = useState([]);
  const [pins, setPins] = useState([]);
  const [balance, setBalance] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [mission, setMission] = useState(null); // { title, subtitle } | null

  /* ---------- hydration from AsyncStorage ---------- */
  useEffect(() => {
    (async () => {
      try {
        const entries = await AsyncStorage.multiGet([
          STORAGE_KEYS.COURSES,
          STORAGE_KEYS.PINS,
          STORAGE_KEYS.BALANCE,
        ]);
        const storedCourses = entries[0][1];
        const storedPins = entries[1][1];
        const storedBalance = entries[2][1];
        if (storedCourses) setCourses(JSON.parse(storedCourses));
        if (storedPins) setPins(JSON.parse(storedPins));
        if (storedBalance) setBalance(parseFloat(storedBalance));
      } catch (error) {
        console.warn('Failed to load saved data', error);
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  /* ---------- persistence (skip until hydrated, or we'd wipe data) ---------- */
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(courses)).catch(
      (error) => console.warn('Failed to save courses', error)
    );
  }, [courses, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEYS.PINS, JSON.stringify(pins)).catch(
      (error) => console.warn('Failed to save pins', error)
    );
  }, [pins, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEYS.BALANCE, String(balance)).catch(
      (error) => console.warn('Failed to save balance', error)
    );
  }, [balance, hydrated]);

  /* ---------- course actions ---------- */
  const handleAddCourse = useCallback((name, ects) => {
    setCourses((prev) => {
      const next = [{ id: makeId(), name, ects }, ...prev];
      const total = next.reduce((sum, c) => sum + c.ects, 0);
      setMission(
        total >= TARGET_ECTS
          ? {
              title: 'GAME COMPLETE!',
              subtitle: `${name.toUpperCase()} · DEGREE UNLOCKED (${total} ECTS)`,
            }
          : {
              title: 'MISSION PASSED!',
              subtitle: `${name.toUpperCase()} · +${ects} ECTS`,
            }
      );
      return next;
    });
  }, []);

  const handleDeleteCourse = useCallback((id) => {
    setCourses((prev) => prev.filter((c) => c.id !== id));
  }, []);

  /* ---------- pin actions ---------- */
  const handleAddPin = useCallback((pin) => {
    setPins((prev) => [...prev, pin]);
  }, []);

  const handleDeletePin = useCallback((id) => {
    setPins((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleMissionDone = useCallback(() => setMission(null), []);

  /* ---------- loading state ---------- */
  if (!hydrated) {
    return (
      <SafeAreaView style={[styles.root, styles.loadingRoot]}>
        <StatusBar style="light" />
        <Text style={styles.loadingText}>LOADING…</Text>
        <Text style={styles.loadingSub}>SAN ANDREAS FOITITIS</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      <View style={styles.content}>
        {activeTab === 'stats' ? (
          <TrackerScreen
            courses={courses}
            onAddCourse={handleAddCourse}
            onDeleteCourse={handleDeleteCourse}
            balance={balance}
            onSetBalance={setBalance}
          />
        ) : (
          <MapScreen
            pins={pins}
            onAddPin={handleAddPin}
            onDeletePin={handleDeletePin}
          />
        )}
      </View>

      {/* Bottom tab bar */}
      <View style={styles.tabBar}>
        {[
          { id: 'stats', label: 'STATS' },
          { id: 'map', label: 'MAP' },
        ].map((tab) => {
          const active = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tabButton, active && styles.tabButtonActive]}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.tabLabel, active && styles.tabLabelActive]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Renders above everything, including the map */}
      <MissionPassedOverlay mission={mission} onDone={handleMissionDone} />
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/*  STYLES                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  /* ----- loading ----- */
  loadingRoot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontFamily: HUD_FONT,
    fontSize: 34,
    fontWeight: '900',
    color: COLORS.hudGold,
    letterSpacing: 3,
  },
  loadingSub: {
    fontFamily: HUD_FONT,
    fontSize: 14,
    color: COLORS.neonGreen,
    letterSpacing: 4,
    marginTop: 8,
  },

  /* ----- HUD panel ----- */
  hudPanel: {
    backgroundColor: COLORS.panel,
    borderWidth: 2,
    borderColor: COLORS.panelBorder,
    margin: 12,
    marginBottom: 6,
    padding: 14,
  },
  hudTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  hudTitle: {
    fontFamily: HUD_FONT,
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.white,
    letterSpacing: 2,
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 1,
  },
  hudSubtitle: {
    fontFamily: HUD_FONT,
    fontSize: 9,
    color: COLORS.textDim,
    letterSpacing: 3,
    marginTop: 3,
  },
  hudBalanceTap: {
    alignItems: 'flex-end',
  },
  hudCashLabel: {
    fontFamily: HUD_FONT,
    fontSize: 9,
    fontWeight: '900',
    color: COLORS.textDim,
    letterSpacing: 3,
    marginBottom: 2,
  },
  hudMoney: {
    fontFamily: HUD_FONT,
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.moneyGreen,
    letterSpacing: 1,
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 1,
  },

  /* ----- HUD bar ----- */
  hudBarBlock: {
    marginBottom: 12,
  },
  hudBarLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  hudBarLabel: {
    fontFamily: HUD_FONT,
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.textDim,
    letterSpacing: 2,
  },
  hudBarValue: {
    fontFamily: HUD_FONT,
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.neonGreen,
    letterSpacing: 1,
  },
  hudBarTrack: {
    height: 22,
    backgroundColor: '#121a10',
    borderWidth: 2,
    borderColor: COLORS.black,
    overflow: 'hidden',
  },
  hudBarFill: {
    flex: 1,
    backgroundColor: COLORS.groveGreen,
  },
  hudBarGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },

  hudFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  hudFooterStat: {
    fontFamily: HUD_FONT,
    fontSize: 11,
    color: COLORS.textDim,
    letterSpacing: 1,
  },
  hudFooterValue: {
    color: COLORS.hudGold,
    fontWeight: '900',
  },
  hudFooterDot: {
    color: COLORS.panelBorder,
    fontSize: 16,
    lineHeight: 16,
  },
  hudCompleteTag: {
    fontFamily: HUD_FONT,
    fontSize: 11,
    fontWeight: '900',
    color: COLORS.groveGreen,
    letterSpacing: 2,
  },

  /* ----- input section ----- */
  inputSection: {
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 6,
  },
  inputSectionLabel: {
    fontFamily: HUD_FONT,
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.neonGreen,
    letterSpacing: 3,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: '#2c3826',
    color: COLORS.white,
    fontFamily: HUD_FONT,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    letterSpacing: 1,
  },
  inputName: {
    flex: 1,
  },
  inputEcts: {
    width: 72,
    textAlign: 'center',
  },
  addButton: {
    marginTop: 10,
    backgroundColor: COLORS.groveGreen,
    borderWidth: 2,
    borderColor: COLORS.black,
    paddingVertical: 11,
    alignItems: 'center',
  },
  addButtonText: {
    fontFamily: HUD_FONT,
    fontSize: 15,
    fontWeight: '900',
    color: '#06140a',
    letterSpacing: 3,
  },

  /* ----- course list ----- */
  courseList: {
    flex: 1,
    marginHorizontal: 12,
  },
  courseListContent: {
    paddingBottom: 16,
  },
  courseListHeader: {
    fontFamily: HUD_FONT,
    fontSize: 11,
    fontWeight: '900',
    color: COLORS.textDim,
    letterSpacing: 2,
    marginVertical: 8,
  },
  courseListEmpty: {
    fontFamily: HUD_FONT,
    fontSize: 13,
    color: COLORS.textDim,
    textAlign: 'center',
    letterSpacing: 1,
    lineHeight: 22,
    marginTop: 24,
  },
  courseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.groveGreen,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  courseRowLeft: {
    flex: 1,
    marginRight: 8,
  },
  courseName: {
    fontFamily: HUD_FONT,
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: 1,
  },
  courseMeta: {
    fontFamily: HUD_FONT,
    fontSize: 9,
    color: COLORS.textDim,
    letterSpacing: 2,
    marginTop: 2,
  },
  courseEcts: {
    fontFamily: HUD_FONT,
    fontSize: 17,
    fontWeight: '900',
    color: COLORS.moneyGreen,
    marginRight: 12,
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },
  courseDeleteBtn: {
    width: 26,
    height: 26,
    borderWidth: 1,
    borderColor: COLORS.healthRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courseDeleteText: {
    color: COLORS.healthRed,
    fontSize: 13,
    fontWeight: '900',
  },

  /* ----- mission overlay ----- */
  missionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  missionInner: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  missionTitle: {
    fontFamily: MISSION_FONT,
    fontSize: 42,
    fontWeight: 'bold',
    fontStyle: 'italic',
    color: COLORS.missionGold,
    letterSpacing: 2,
    textAlign: 'center',
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 1,
  },
  missionRespect: {
    fontFamily: MISSION_FONT,
    fontSize: 22,
    fontWeight: 'bold',
    fontStyle: 'italic',
    color: COLORS.neonGreen,
    marginTop: 10,
    letterSpacing: 3,
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 1,
  },
  missionSub: {
    fontFamily: HUD_FONT,
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.white,
    marginTop: 14,
    letterSpacing: 2,
    textAlign: 'center',
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },

  /* ----- map / radar ----- */
  blip: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderColor: COLORS.black,
    transform: [{ rotate: '45deg' }],
  },
  blipSmall: {
    width: 10,
    height: 10,
    borderWidth: 1,
    borderColor: COLORS.black,
    transform: [{ rotate: '45deg' }],
    marginRight: 8,
  },
  legend: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    backgroundColor: COLORS.panel,
    borderWidth: 2,
    borderColor: COLORS.panelBorder,
    padding: 10,
    maxWidth: 250,
  },
  legendTitle: {
    fontFamily: HUD_FONT,
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.hudGold,
    letterSpacing: 2,
    marginBottom: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  legendLabel: {
    fontFamily: HUD_FONT,
    fontSize: 10,
    color: COLORS.white,
    letterSpacing: 1,
  },
  legendHint: {
    fontFamily: HUD_FONT,
    fontSize: 8,
    color: COLORS.textDim,
    letterSpacing: 1,
    marginTop: 6,
  },

  /* ----- waypoint modal ----- */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalPanel: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.panel,
    borderWidth: 2,
    borderColor: COLORS.groveGreen,
    padding: 16,
  },
  modalTitle: {
    fontFamily: HUD_FONT,
    fontSize: 20,
    fontWeight: '900',
    color: COLORS.hudGold,
    letterSpacing: 3,
    marginBottom: 12,
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 1,
  },
  modalInput: {
    marginBottom: 14,
  },
  modalSectionLabel: {
    fontFamily: HUD_FONT,
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.textDim,
    letterSpacing: 2,
    marginBottom: 6,
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  categoryOptionText: {
    fontFamily: HUD_FONT,
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: 1,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 2,
  },
  modalButtonCancel: {
    borderColor: COLORS.textDim,
  },
  modalButtonCancelText: {
    fontFamily: HUD_FONT,
    fontSize: 13,
    fontWeight: '900',
    color: COLORS.textDim,
    letterSpacing: 2,
  },
  modalButtonSave: {
    backgroundColor: COLORS.groveGreen,
    borderColor: COLORS.black,
  },
  modalButtonSaveText: {
    fontFamily: HUD_FONT,
    fontSize: 13,
    fontWeight: '900',
    color: '#06140a',
    letterSpacing: 2,
  },

  /* ----- tab bar ----- */
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.panel,
    borderTopWidth: 2,
    borderTopColor: COLORS.panelBorder,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: COLORS.neonGreen,
    backgroundColor: 'rgba(124,252,90,0.07)',
  },
  tabLabel: {
    fontFamily: HUD_FONT,
    fontSize: 15,
    fontWeight: '900',
    color: COLORS.textDim,
    letterSpacing: 4,
  },
  tabLabelActive: {
    color: COLORS.neonGreen,
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },
});
