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
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';

/* ------------------------------------------------------------------ */
/*  CONSTANTS                                                          */
/* ------------------------------------------------------------------ */

const TARGET_ECTS = 240;

const STORAGE_KEYS = {
  COURSES: '@gta_foititis_courses_v1',
  PINS: '@gta_foititis_pins_v1',
  BALANCE: '@gta_foititis_balance_v1',
  PROJECTS: '@gta_foititis_projects_v1',
};

// Centered on Athens — Syntagma-ish, wide enough to cover NKUA & the center.
const ATHENS_REGION = {
  latitude: 37.9755,
  longitude: 23.7348,
  latitudeDelta: 0.09,
  longitudeDelta: 0.09,
};

/*
 * Pin types for the radar. To add one with a custom icon, drop a PNG in
 * assets/pins/ and add a row with `image: require('./assets/pins/foo.png')`.
 * While `image` is null the blip falls back to an SA-style letter square
 * using `color` + `icon`.
 */
const PIN_TYPES = [
  { id: 'coffee', label: 'CHEAP COFFEE', color: '#F5A623', icon: 'C', image: null },
  { id: 'study', label: 'STUDY SPOTS', color: '#4FC3F7', icon: '📚', image: null, emoji: true },
  { id: 'eats', label: 'HIGH-PROTEIN CHEAP EATS', color: '#FF5252', icon: 'E', image: null },
  { id: 'skate', label: 'SKATE / CRUISING ROUTES', color: '#7CFC5A', icon: 'R', image: null },
  { id: 'library', label: 'LIBRARIES', color: '#003462', icon: 'L', image: require('./assets/pins/library.png') },
  { id: 'dit', label: 'NKUA DIT', color: '#4A90D9', icon: 'D', image: require('./assets/pins/dit.png') },
];

// Permanent map markers (not stored in AsyncStorage, not deletable).
// Libraries of Athens + NKUA DIT.
const STATIC_PINS = [
  { id: 'dit-nkua', name: 'NKUA · DIT', category: 'dit', latitude: 37.9681363, longitude: 23.7665448 },
];

const PIN_TYPE_BY_ID = Object.fromEntries(PIN_TYPES.map((c) => [c.id, c]));

/*
 * Live OASA buses. Put the line numbers you care about here (the public
 * LineID printed on the bus, e.g. '608', '230', '040') with a blip color.
 * Positions come from the OASA telematics API and refresh every 10s.
 */
const BUS_LINES = [
  { id: '140', color: '#FF4444' }, // POLYGONO - GLYFADA (red)
  { id: '4', color: '#4FC3F7' }, // ANO KYPSELI - AG. ARTEMIOS trolley (blue)
  { id: '250', color: '#7CFC5A' }, // PANEPISTIMIOUPOLI - EVAGGELISMOS (lime)
];

const OASA_API = 'https://telematics.oasa.gr/api/';
const BUS_POLL_MS = 10000;

async function oasaGet(query) {
  const res = await fetch(`${OASA_API}?act=${query}`, { method: 'POST' });
  return res.json();
}

// CJ's radar blip from the game's hud.txd — used as the live-location marker.
const CJ_ICON = require('./assets/radar_CJ.png');

// San Andreas HUD palette.
// Monochrome base (black / gray / white) with a single SA-gold accent.
const COLORS = {
  bg: '#0A0A0A',
  panel: 'rgba(14, 14, 14, 0.92)',
  panelBorder: '#262626',
  accent: '#E8C547',
  hudGold: '#E8C547',
  missionGold: '#DCBE6C',
  healthRed: '#B4191D',
  armorGrey: '#5C7A98',
  textDim: '#8F8F88',
  white: '#F2F2F0',
  black: '#000000',
};

// Chunky, condensed system fonts — closest stand-in for Pricedown
// without bundling font assets.
const HUD_FONT = Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' });
const MISSION_FONT = Platform.select({ ios: 'Georgia-BoldItalic', android: 'serif' });

// Gritty dark in-game radar palette for Google-provider maps. In Expo Go
// on iOS the map is Apple Maps, which ignores customMapStyle — dark mode
// there comes from the MapView's userInterfaceStyle="dark" prop.
const DARK_RADAR_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0d130c' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7a62' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#070a06' }] },
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
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#04090c' }],
  },
];

// Alternative: classic SA paper-map palette (light). Swap it into the
// MapView's customMapStyle prop if you prefer the paper-map look on
// Google-provider builds.
const SA_PAPER_MAP_STYLE = [
  // Concrete-gray base, like the SA map background.
  { elementType: 'geometry', stylers: [{ color: '#b8b8b6' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#2b2b2b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#e8e8e4' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#8f8f8c' }],
  },
  // City blocks read as white slabs.
  {
    featureType: 'landscape.man_made',
    elementType: 'geometry',
    stylers: [{ color: '#dadad6' }],
  },
  {
    featureType: 'landscape.natural',
    elementType: 'geometry',
    stylers: [{ color: '#aab3a0' }],
  },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'poi.business',
    elementType: 'geometry',
    stylers: [{ color: '#ffffff' }, { visibility: 'on' }],
  },
  // SA-green parks.
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#5e8a3a' }, { visibility: 'on' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#2f4a1c' }],
  },
  // All roads bold and black, like the in-game map.
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1a1a1a' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#1a1a1a' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#1f1f1f' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#d9d9d5' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#000000' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#000000' }],
  },
  {
    featureType: 'road.local',
    elementType: 'geometry',
    stylers: [{ color: '#2e2e2e' }],
  },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  // Steel-blue SA ocean.
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#7298c4' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#2c4a73' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#a9c2de' }],
  },
];

const makeId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Parses "DD/MM", "DD/MM/YY", or "DD/MM/YYYY". Returns a Date or null.
function parseDue(str) {
  const parts = str.trim().split(/[\/\-\.]/);
  if (parts.length < 2) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const now = new Date();
  let year = now.getFullYear();
  if (parts[2]) {
    year = parts[2].length === 2 ? 2000 + parseInt(parts[2], 10) : parseInt(parts[2], 10);
  }
  const d = new Date(year, month, day);
  if (isNaN(d.getTime())) return null;
  // If no year given and date already passed, bump to next year.
  if (!parts[2] && d < now) d.setFullYear(year + 1);
  return d;
}

function daysLeft(dueDate) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((dueDate - now) / 86400000);
}

const hexAlpha = (hex, a) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};

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
/*  PROJECT ROW                                                        */
/* ------------------------------------------------------------------ */

const ProjectRow = React.memo(function ProjectRow({ project, onDelete }) {
  const due = parseDue(project.due);
  const days = due ? daysLeft(due) : null;

  let daysColor = COLORS.white;
  let daysLabel = '—';
  if (days !== null) {
    if (days < 0) { daysColor = COLORS.healthRed; daysLabel = 'OVERDUE'; }
    else if (days === 0) { daysColor = COLORS.healthRed; daysLabel = 'TODAY'; }
    else if (days <= 2) { daysColor = COLORS.healthRed; daysLabel = `${days}D LEFT`; }
    else if (days <= 6) { daysColor = COLORS.accent; daysLabel = `${days}D LEFT`; }
    else { daysColor = COLORS.textDim; daysLabel = `${days}D`; }
  }

  return (
    <View style={styles.projectRow}>
      <View style={styles.projectRowLeft}>
        <Text style={styles.projectName} numberOfLines={1}>{project.name}</Text>
        <Text style={styles.projectDue}>{project.due}</Text>
      </View>
      <Text style={[styles.projectDays, { color: daysColor }]}>{daysLabel}</Text>
      <TouchableOpacity
        style={styles.courseDeleteBtn}
        onPress={() => onDelete(project)}
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

function TrackerScreen({ courses, onAddCourse, onDeleteCourse, balance, onSetBalance, projects, onAddProject, onDeleteProject }) {
  const [name, setName] = useState('');
  const [ectsText, setEctsText] = useState('');
  const [balanceVisible, setBalanceVisible] = useState(false);
  const [showCourses, setShowCourses] = useState(false);
  const [showProjects, setShowProjects] = useState(true);
  const [projName, setProjName] = useState('');
  const [projDue, setProjDue] = useState('');

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

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const da = parseDue(a.due);
      const db = parseDue(b.due);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });
  }, [projects]);

  const handleAddProject = useCallback(() => {
    const trimmed = projName.trim();
    if (!trimmed) {
      Alert.alert('MISSION FAILED', 'Give the project a name.');
      return;
    }
    if (projDue.trim() && !parseDue(projDue)) {
      Alert.alert('MISSION FAILED', 'Use DD/MM or DD/MM/YY format for the date.');
      return;
    }
    Keyboard.dismiss();
    onAddProject({ id: makeId(), name: trimmed, due: projDue.trim() || '—' });
    setProjName('');
    setProjDue('');
  }, [projName, projDue, onAddProject]);

  const handleDeleteProject = useCallback((project) => {
    Alert.alert('WASTED', `Remove "${project.name}"?`, [
      { text: 'CANCEL', style: 'cancel' },
      { text: 'REMOVE', style: 'destructive', onPress: () => onDeleteProject(project.id) },
    ]);
  }, [onDeleteProject]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.trackerScroll}
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

        {/* Active projects / assignments */}
        <TouchableOpacity
          style={styles.coursesToggle}
          onPress={() => setShowProjects((p) => !p)}
          activeOpacity={0.8}
        >
          <Text style={styles.coursesToggleText}>
            {showProjects
              ? '▲ HIDE ACTIVE MISSIONS'
              : `▼ ACTIVE MISSIONS (${String(projects.length).padStart(2, '0')})`}
          </Text>
        </TouchableOpacity>

        {showProjects && (
          <>
            <View style={[styles.inputSection, { paddingTop: 8 }]}>
              <View style={styles.inputRow}>
                <TextInput
                  style={[styles.input, styles.inputName, { color: COLORS.white }]}
                  placeholder="PROJECT NAME"
                  placeholderTextColor={COLORS.textDim}
                  value={projName}
                  onChangeText={setProjName}
                  returnKeyType="next"
                  autoCapitalize="characters"
                />
                <TextInput
                  style={[styles.input, { width: 90, color: COLORS.white }]}
                  placeholder="DD/MM"
                  placeholderTextColor={COLORS.textDim}
                  value={projDue}
                  onChangeText={setProjDue}
                  returnKeyType="done"
                  maxLength={10}
                  onSubmitEditing={handleAddProject}
                />
              </View>
              <TouchableOpacity
                style={[styles.addButton, { backgroundColor: COLORS.armorGrey }]}
                onPress={handleAddProject}
                activeOpacity={0.8}
              >
                <Text style={[styles.addButtonText, { color: COLORS.white }]}>ADD MISSION</Text>
              </TouchableOpacity>
            </View>

            {sortedProjects.length === 0 ? (
              <Text style={[styles.courseListEmpty, { marginHorizontal: 12 }]}>
                NO ACTIVE MISSIONS.{'\n'}ENJOY THE PEACE WHILE IT LASTS.
              </Text>
            ) : (
              sortedProjects.map((item) => (
                <View key={item.id} style={{ marginHorizontal: 12 }}>
                  <ProjectRow project={item} onDelete={handleDeleteProject} />
                </View>
              ))
            )}
          </>
        )}

        {/* Completed course list toggle */}
        <TouchableOpacity
          style={styles.coursesToggle}
          onPress={() => setShowCourses((prev) => !prev)}
          activeOpacity={0.8}
        >
          <Text style={styles.coursesToggleText}>
            {showCourses
              ? '▲ HIDE CLASSES'
              : `▼ SEE ALL CLASSES (${String(courses.length).padStart(2, '0')})`}
          </Text>
        </TouchableOpacity>

        {showCourses && (
          courses.length === 0 ? (
            <Text style={[styles.courseListEmpty, { marginHorizontal: 12 }]}>
              NO MISSIONS COMPLETED YET.{'\n'}AH SHIT, HERE WE GO AGAIN.
            </Text>
          ) : (
            courses.map((item) => (
              <View key={item.id} style={{ marginHorizontal: 12 }}>
                <CourseRow course={item} onDelete={handleDelete} />
              </View>
            ))
          )
        )}
      </ScrollView>

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

// Renders a pin type's icon: the custom PNG when one is set, otherwise the
// SA letter-square fallback. `size` is the icon's edge in px.
function Blip({ type, size }) {
  if (type.image) {
    return (
      <Image
        source={type.image}
        style={{ width: size, height: size, resizeMode: 'contain' }}
      />
    );
  }
  if (type.emoji) {
    return (
      <Text style={{ fontSize: size * 0.8, lineHeight: size }}>
        {type.icon}
      </Text>
    );
  }
  const border = size >= 24 ? 2 : 1;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderWidth: border,
        borderColor: COLORS.black,
      }}
    >
      <View style={[styles.blipFace, { backgroundColor: type.color, borderWidth: border }]}>
        <Text style={[styles.blipIcon, { fontSize: size * 0.55, lineHeight: size * 0.65 }]}>
          {type.icon}
        </Text>
      </View>
    </View>
  );
}

// Live bus blip that glides to each new GPS fix instead of teleporting.
// Plain JS tween — Marker.Animated/AnimatedRegion don't work on the
// new architecture (Expo SDK 54), so we step the coordinate manually.
const BUS_TWEEN_STEPS = 12;
const BusMarker = React.memo(function BusMarker({ bus }) {
  const [coord, setCoord] = useState({
    latitude: bus.latitude,
    longitude: bus.longitude,
  });
  const coordRef = useRef(coord);

  useEffect(() => {
    const from = coordRef.current;
    const to = { latitude: bus.latitude, longitude: bus.longitude };
    if (from.latitude === to.latitude && from.longitude === to.longitude) {
      return undefined;
    }
    let step = 0;
    const interval = setInterval(() => {
      step += 1;
      const t = step / BUS_TWEEN_STEPS;
      const next =
        t >= 1
          ? to
          : {
              latitude: from.latitude + (to.latitude - from.latitude) * t,
              longitude: from.longitude + (to.longitude - from.longitude) * t,
            };
      coordRef.current = next;
      setCoord(next);
      if (t >= 1) clearInterval(interval);
    }, (BUS_POLL_MS * 0.9) / BUS_TWEEN_STEPS);
    return () => clearInterval(interval);
  }, [bus.latitude, bus.longitude]);

  return (
    <Marker
      coordinate={coord}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={500}
      title={`BUS ${bus.lineId}`}
      description={`VEHICLE ${bus.id}`}
    >
      <View style={[styles.busBlip, { backgroundColor: bus.color }]}>
        <Text style={styles.busBlipText}>{bus.lineId}</Text>
      </View>
    </Marker>
  );
});

const PinMarker = React.memo(function PinMarker({ pin, onCalloutPress, isStatic }) {
  const type = PIN_TYPE_BY_ID[pin.category] || PIN_TYPES[0];
  return (
    <Marker
      coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
      title={pin.name}
      description={type.label}
      onCalloutPress={isStatic ? undefined : () => onCalloutPress(pin)}
      tracksViewChanges={false}
    >
      <Blip type={type} size={isStatic ? 36 : 30} />
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
  const [draftType, setDraftType] = useState(PIN_TYPES[0].id);
  const [userCoord, setUserCoord] = useState(null);
  const [buses, setBuses] = useState([]);
  const [busStops, setBusStops] = useState([]);
  const [busPaths, setBusPaths] = useState([]);
  const mapRef = useRef(null);
  // routeCode -> public LineID, filled during init; used to label arrivals.
  const routeLineRef = useRef({});

  // Live OASA buses: resolve each LineID to its route codes and stops once,
  // then poll getBusLocation for every route on an interval.
  useEffect(() => {
    if (BUS_LINES.length === 0) return undefined;
    let cancelled = false;
    let timer = null;

    (async () => {
      try {
        const allLines = await oasaGet('webGetLines');
        const tracked = [];
        const stops = [];
        const paths = [];
        const seenStops = new Set();
        for (const line of BUS_LINES) {
          // A public line number can map to several LineCodes (detour /
          // short-turn variants) — track the routes of all of them.
          const lineCodes = allLines
            .filter((l) => l.LineID === line.id)
            .map((l) => l.LineCode);
          const routeCodes = [];
          for (const code of lineCodes) {
            const routes = await oasaGet(`webGetRoutes&p1=${code}`);
            if (Array.isArray(routes)) {
              for (const r of routes) {
                routeCodes.push(r.RouteCode);
                routeLineRef.current[r.RouteCode] = line.id;
              }
            }
          }
          tracked.push({ line, routeCodes });
          for (const routeCode of routeCodes) {
            try {
              // Street-following shape of the route, for the polyline.
              const points = await oasaGet(`webRouteDetails&p1=${routeCode}`);
              if (Array.isArray(points) && points.length > 1) {
                paths.push({
                  id: routeCode,
                  color: line.color,
                  coords: points.map((p) => ({
                    latitude: parseFloat(p.routed_y),
                    longitude: parseFloat(p.routed_x),
                  })),
                });
              }
              const routeStops = await oasaGet(`webGetStops&p1=${routeCode}`);
              if (!Array.isArray(routeStops)) continue;
              for (const s of routeStops) {
                if (seenStops.has(s.StopCode)) continue;
                seenStops.add(s.StopCode);
                stops.push({
                  id: s.StopCode,
                  name: s.StopDescr,
                  color: line.color,
                  latitude: parseFloat(s.StopLat),
                  longitude: parseFloat(s.StopLng),
                });
              }
            } catch (error) {
              // Skip a route whose stop list fails to load.
            }
          }
        }
        if (cancelled) return;
        setBusStops(stops);
        setBusPaths(paths);

        const poll = async () => {
          const next = [];
          const seen = new Set();
          for (const { line, routeCodes } of tracked) {
            for (const routeCode of routeCodes) {
              try {
                const vehicles = await oasaGet(`getBusLocation&p1=${routeCode}`);
                if (!Array.isArray(vehicles)) continue;
                for (const v of vehicles) {
                  if (seen.has(v.VEH_NO)) continue;
                  seen.add(v.VEH_NO);
                  next.push({
                    id: v.VEH_NO,
                    lineId: line.id,
                    color: line.color,
                    latitude: parseFloat(v.CS_LAT),
                    longitude: parseFloat(v.CS_LNG),
                  });
                }
              } catch (error) {
                // One route failing shouldn't kill the rest of the sweep.
              }
            }
          }
          if (cancelled) return;
          setBuses(next);
          timer = setTimeout(poll, BUS_POLL_MS);
        };
        poll();
      } catch (error) {
        console.warn('OASA bus tracking failed', error);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Follow the player: request permission once, then keep the CJ blip
  // in sync with the device's position.
  useEffect(() => {
    let cancelled = false;
    let subscription = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') return;
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 4000,
            distanceInterval: 10,
          },
          (position) => {
            setUserCoord({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          }
        );
        if (cancelled) subscription.remove();
      } catch (error) {
        console.warn('Location tracking failed', error);
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  const handleLongPress = useCallback((event) => {
    const { coordinate } = event.nativeEvent;
    setDraftName('');
    setDraftType(PIN_TYPES[0].id);
    setDraftCoord(coordinate);
  }, []);

  const handleSavePin = useCallback(() => {
    if (!draftCoord) return;
    onAddPin({
      id: makeId(),
      name: draftName.trim() || 'UNKNOWN SPOT',
      category: draftType,
      latitude: draftCoord.latitude,
      longitude: draftCoord.longitude,
    });
    setDraftCoord(null);
  }, [draftCoord, draftName, draftType, onAddPin]);

  const handleCancelPin = useCallback(() => setDraftCoord(null), []);

  // Tap a stop dot → live ETAs for the tracked lines at that stop.
  const handleStopPress = useCallback(async (stop) => {
    try {
      const arrivals = await oasaGet(`getStopArrivals&p1=${stop.id}`);
      const incoming = (Array.isArray(arrivals) ? arrivals : [])
        .map((a) => ({
          lineId: routeLineRef.current[a.route_code],
          mins: parseInt(a.btime2, 10),
        }))
        .filter((a) => a.lineId && !Number.isNaN(a.mins))
        .sort((a, b) => a.mins - b.mins);
      const message = incoming.length
        ? incoming.map((a) => `BUS ${a.lineId} — ${a.mins} MIN`).join('\n')
        : 'NO TRACKED BUSES INCOMING';
      Alert.alert(stop.name, message);
    } catch (error) {
      Alert.alert(stop.name, 'ARRIVALS UNAVAILABLE');
    }
  }, []);

  const handleCalloutPress = useCallback(
    (pin) => {
      const type = PIN_TYPE_BY_ID[pin.category] || PIN_TYPES[0];
      Alert.alert(pin.name, type.label, [
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
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={ATHENS_REGION}
        customMapStyle={DARK_RADAR_MAP_STYLE}
        userInterfaceStyle="dark"
        onLongPress={handleLongPress}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        {/* Route lines of the tracked buses */}
        {busPaths.map((path) => (
          <Polyline
            key={path.id}
            coordinates={path.coords}
            strokeColor={hexAlpha(path.color, 0.5)}
            strokeWidth={2}
          />
        ))}
        {STATIC_PINS.map((pin) => (
          <PinMarker key={pin.id} pin={pin} onCalloutPress={null} isStatic />
        ))}
        {pins.map((pin) => (
          <PinMarker key={pin.id} pin={pin} onCalloutPress={handleCalloutPress} />
        ))}
        {/* Bus stops of the tracked lines — tiny dots */}
        {busStops.map((stop) => (
          <Marker
            key={stop.id}
            coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => handleStopPress(stop)}
            tracksViewChanges={false}
          >
            {/* Transparent padding makes the 5px dot tappable */}
            <View style={styles.busStopTouch}>
              <View
                style={[styles.busStopDot, { backgroundColor: stop.color }]}
              />
            </View>
          </Marker>
        ))}
        {/* Live OASA buses for the tracked lines */}
        {buses.map((bus) => (
          <BusMarker key={bus.id} bus={bus} />
        ))}
        {/* The player: CJ's blip from hud.txd instead of the stock blue dot */}
        {userCoord && (
          <Marker
            coordinate={userCoord}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={999}
            tracksViewChanges={false}
          >
            <Image source={CJ_ICON} style={styles.playerIcon} />
          </Marker>
        )}
      </MapView>

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

            <Text style={styles.modalSectionLabel}>PICK A BLIP</Text>
            <View style={styles.pinGrid}>
              {PIN_TYPES.map((type) => {
                const selected = type.id === draftType;
                return (
                  <TouchableOpacity
                    key={type.id}
                    style={[
                      styles.pinTile,
                      selected && {
                        borderColor: type.color,
                        backgroundColor: 'rgba(255,255,255,0.08)',
                      },
                    ]}
                    onPress={() => setDraftType(type.id)}
                    activeOpacity={0.7}
                  >
                    <Blip type={type} size={34} />
                    <Text
                      style={[
                        styles.pinTileLabel,
                        selected && { color: type.color },
                      ]}
                      numberOfLines={2}
                    >
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

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
  const [projects, setProjects] = useState([]);
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
          STORAGE_KEYS.PROJECTS,
        ]);
        const storedCourses = entries[0][1];
        const storedPins = entries[1][1];
        const storedBalance = entries[2][1];
        const storedProjects = entries[3][1];
        if (storedCourses) setCourses(JSON.parse(storedCourses));
        if (storedPins) setPins(JSON.parse(storedPins));
        if (storedBalance) setBalance(parseFloat(storedBalance));
        if (storedProjects) setProjects(JSON.parse(storedProjects));
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

  /* ---------- project persistence ---------- */
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects)).catch(
      (error) => console.warn('Failed to save projects', error)
    );
  }, [projects, hydrated]);

  /* ---------- project actions ---------- */
  const handleAddProject = useCallback((project) => {
    setProjects((prev) => [...prev, project]);
  }, []);

  const handleDeleteProject = useCallback((id) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
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
            projects={projects}
            onAddProject={handleAddProject}
            onDeleteProject={handleDeleteProject}
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

  trackerScroll: {
    paddingBottom: 40,
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
    color: COLORS.textDim,
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
    color: COLORS.accent,
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
    color: COLORS.white,
    letterSpacing: 1,
  },
  hudBarTrack: {
    height: 22,
    backgroundColor: '#161616',
    borderWidth: 2,
    borderColor: COLORS.black,
    overflow: 'hidden',
  },
  hudBarFill: {
    flex: 1,
    backgroundColor: COLORS.accent,
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
    color: COLORS.accent,
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
    color: COLORS.textDim,
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
    borderColor: '#333330',
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
    backgroundColor: COLORS.accent,
    borderWidth: 2,
    borderColor: COLORS.black,
    paddingVertical: 11,
    alignItems: 'center',
  },
  addButtonText: {
    fontFamily: HUD_FONT,
    fontSize: 15,
    fontWeight: '900',
    color: '#121212',
    letterSpacing: 3,
  },

  /* ----- course list ----- */
  coursesToggle: {
    backgroundColor: COLORS.panel,
    borderWidth: 2,
    borderColor: COLORS.panelBorder,
    marginHorizontal: 12,
    marginVertical: 6,
    paddingVertical: 11,
    alignItems: 'center',
  },
  coursesToggleText: {
    fontFamily: HUD_FONT,
    fontSize: 14,
    fontWeight: '900',
    color: COLORS.white,
    letterSpacing: 2,
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 1,
  },
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
    borderLeftColor: '#3A3A3A',
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
    color: COLORS.accent,
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

  /* ----- project rows ----- */
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.armorGrey,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  projectRowLeft: {
    flex: 1,
    marginRight: 8,
  },
  projectName: {
    fontFamily: HUD_FONT,
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: 1,
  },
  projectDue: {
    fontFamily: HUD_FONT,
    fontSize: 9,
    color: COLORS.textDim,
    letterSpacing: 2,
    marginTop: 2,
  },
  projectDays: {
    fontFamily: HUD_FONT,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    marginRight: 12,
    minWidth: 64,
    textAlign: 'right',
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
    color: COLORS.accent,
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
  blipFace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // PS2-era bevel: light catch on top/left, shadow on bottom/right.
    borderWidth: 2,
    borderTopColor: 'rgba(255,255,255,0.55)',
    borderLeftColor: 'rgba(255,255,255,0.55)',
    borderBottomColor: 'rgba(0,0,0,0.45)',
    borderRightColor: 'rgba(0,0,0,0.45)',
  },
  blipIcon: {
    fontFamily: HUD_FONT,
    fontWeight: '900',
    color: COLORS.black,
  },
  busBlip: {
    minWidth: 18,
    height: 14,
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: COLORS.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busBlipText: {
    fontFamily: HUD_FONT,
    fontSize: 8,
    fontWeight: '900',
    color: COLORS.black,
    letterSpacing: 0.5,
  },
  busStopTouch: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busStopDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.black,
    opacity: 0.4,
  },
  playerIcon: {
    width: 36,
    height: 36,
    resizeMode: 'contain',
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
    borderColor: '#3A3A3A',
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
  pinGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  pinTile: {
    width: '23%',
    flexGrow: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  pinTileLabel: {
    fontFamily: HUD_FONT,
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 5,
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
    backgroundColor: COLORS.accent,
    borderColor: COLORS.black,
  },
  modalButtonSaveText: {
    fontFamily: HUD_FONT,
    fontSize: 13,
    fontWeight: '900',
    color: '#121212',
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
    borderBottomColor: COLORS.accent,
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
    color: COLORS.accent,
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },
});
