package com.freeosc.studio;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StageOscUdpPlugin.class);
        registerPlugin(StageOscMidiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}