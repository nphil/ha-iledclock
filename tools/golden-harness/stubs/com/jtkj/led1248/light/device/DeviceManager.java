package com.jtkj.led1248.light.device;

import java.io.Serializable;

/**
 * STUB: the real DeviceManager is ~9900 lines of BLE connection/session
 * state. Only the mutable device-geometry statics that gate font-table
 * selection in ILedClockUtils' clock/date/timeCount/scoreboard encoders,
 * and the TimerSwitchItem value class used by setTimerSwitch, are
 * reproduced (per assignment constraints). Fields keep the real defaults
 * from the decompiled source; Golden.java overrides DEVICE_ROW/DEVICE_COLUMN
 * per-vector to exercise multiple device geometries.
 */
public final class DeviceManager {
    private DeviceManager() {}

    public static int DEVICE_ROW = 16;
    public static int DEVICE_COLUMN = 64;
    public static int CoolleduxDeviceVersion = -1;

    public static class TimerSwitchItem implements Serializable {
        private static final long serialVersionUID = -6534458121620424861L;
        public int hour;
        public boolean isFridayOn;
        public boolean isMondayOn;
        public boolean isSaturdayOn;
        public boolean isSundayOn;
        public boolean isThursdayOn;
        public boolean isTuesdayOn;
        public boolean isWednesdayOn;
        public int minute;
        public boolean enable = true;
        public boolean isNever = true;
        public boolean isSetDeviceOn = true;

        public String toString() {
            return "TimerSwitchItem{enable=" + this.enable + ", hour=" + this.hour + ", minute=" + this.minute
                    + ", isMondayOn=" + this.isMondayOn + ", isTuesdayOn=" + this.isTuesdayOn
                    + ", isWednesdayOn=" + this.isWednesdayOn + ", isThursdayOn=" + this.isThursdayOn
                    + ", isFridayOn=" + this.isFridayOn + ", isSaturdayOn=" + this.isSaturdayOn
                    + ", isSundayOn=" + this.isSundayOn + ", isNever=" + this.isNever
                    + ", isSetDeviceOn=" + this.isSetDeviceOn + '}';
        }
    }
}
