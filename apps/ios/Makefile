APP_NAME  := Counter
SCHEME    := Counter
BUNDLE_ID := ltd.counter.app
PROJECT   := Counter.xcodeproj
BUILD_DIR := build
DERIVED   := $(BUILD_DIR)/DerivedData
CONFIG    ?= Debug

# Simulator selection. Override on the command line:
#   make sim SIM_NAME="iPhone 17 Pro"
SIM_NAME  ?= iPhone 17
SIM_DEST  := "platform=iOS Simulator,name=$(SIM_NAME)"

# Device selection. If exactly one iPhone is paired we detect it automatically.
# Pass DEVICE=<udid> or DEVICE_NAME="My iPhone" to force a specific one.
DEVICE      ?=
DEVICE_NAME ?=

.PHONY: all build run sim device device-install device-launch stop clean help

all: build

help:
	@echo "Simulator:"
	@echo "  make build   — build for the iOS simulator"
	@echo "  make run     — build, boot sim, install, launch"
	@echo "  make stop    — terminate the running sim instance"
	@echo ""
	@echo "Device (requires a paired, unlocked iPhone):"
	@echo "  make device         — build + install + launch"
	@echo "  make device-install — build + install (no launch)"
	@echo "  make device-launch  — relaunch the already-installed app"
	@echo ""
	@echo "Overrides:"
	@echo "  SIM_NAME=\"iPhone 17 Pro\"   pick a different simulator"
	@echo "  DEVICE=<udid>              target a specific iPhone by UDID"
	@echo "  DEVICE_NAME=\"My iPhone\"    target a specific iPhone by name"
	@echo "  CONFIG=Release             build with Release optimisations"

build:
	@mkdir -p $(BUILD_DIR)
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-configuration $(CONFIG) \
		-destination $(SIM_DEST) \
		-derivedDataPath $(DERIVED) \
		build | xcbeautify --quiet 2>/dev/null || \
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-configuration $(CONFIG) \
		-destination $(SIM_DEST) \
		-derivedDataPath $(DERIVED) \
		build

run: build
	@xcrun simctl boot "$(SIM_NAME)" 2>/dev/null || true
	@open -a Simulator
	@APP=$$(find $(DERIVED)/Build/Products -name "$(APP_NAME).app" -type d | head -n1); \
	if [ -z "$$APP" ]; then echo "No built .app found in $(DERIVED)"; exit 1; fi; \
	xcrun simctl install "$(SIM_NAME)" "$$APP"; \
	xcrun simctl launch "$(SIM_NAME)" $(BUNDLE_ID)

stop:
	@xcrun simctl terminate "$(SIM_NAME)" $(BUNDLE_ID) 2>/dev/null || true

clean:
	rm -rf $(BUILD_DIR)

# ============================================================
# Device deployment
# ============================================================
#
# The device must be paired (plug in once, accept "Trust This Computer",
# unlock). For wireless deployment, enable "Connect via network" in
# Finder → device → General after the first cable pairing.

DEVICE_UDID = $(shell \
	if [ -n "$(DEVICE)" ]; then \
		echo "$(DEVICE)"; \
	else \
		xcrun devicectl list devices 2>/dev/null \
			| awk -v name="$(DEVICE_NAME)" '\
				/^----/ {next} \
				name != "" && index($$0, name) == 0 {next} \
				{ \
					if (match($$0, /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/)) { \
						print substr($$0, RSTART, RLENGTH); exit \
					} \
				}'; \
	fi)

build-device:
	@mkdir -p $(BUILD_DIR)
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-configuration $(CONFIG) \
		-destination 'generic/platform=iOS' \
		-derivedDataPath $(DERIVED) \
		-allowProvisioningUpdates \
		build | xcbeautify --quiet 2>/dev/null || \
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-configuration $(CONFIG) \
		-destination 'generic/platform=iOS' \
		-derivedDataPath $(DERIVED) \
		-allowProvisioningUpdates \
		build

device: device-install device-launch

device-install: build-device
	@if [ -z "$(DEVICE_UDID)" ]; then \
		echo ""; \
		echo "No paired iPhone found. Steps:" >&2; \
		echo "  1. Plug your phone in (or pair over Wi-Fi via Finder)." >&2; \
		echo "  2. Unlock it and accept 'Trust This Computer'." >&2; \
		echo "  3. Run: xcrun devicectl list devices" >&2; \
		echo "     If it lists the phone, re-run \`make device\`." >&2; \
		echo ""; \
		exit 1; \
	fi
	@APP=$$(find $(DERIVED)/Build/Products/Debug-iphoneos -name "$(APP_NAME).app" -type d | head -n1); \
	if [ -z "$$APP" ]; then echo "No iOS-device .app found in $(DERIVED)"; exit 1; fi; \
	echo "Installing $$APP to $(DEVICE_UDID)..."; \
	xcrun devicectl device install app --device "$(DEVICE_UDID)" "$$APP"

device-launch:
	@if [ -z "$(DEVICE_UDID)" ]; then echo "No paired iPhone — run \`make device\` first."; exit 1; fi
	@echo "Launching $(BUNDLE_ID) on $(DEVICE_UDID)..."
	xcrun devicectl device process launch --device "$(DEVICE_UDID)" "$(BUNDLE_ID)" || true
