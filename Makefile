STREAMING_WASM := target/wasm32-unknown-unknown/release/soromint_streaming.wasm
STREAMING_OPT  := target/wasm32-unknown-unknown/release/soromint_streaming.optimized.wasm

.PHONY: build build-streaming clean

build: build-streaming

build-streaming:
	cargo build --release --target wasm32-unknown-unknown -p soromint-streaming
	@PRE=$$(wc -c < $(STREAMING_WASM)); \
	wasm-opt -Oz --strip-debug --strip-producers \
		$(STREAMING_WASM) -o $(STREAMING_OPT); \
	POST=$$(wc -c < $(STREAMING_OPT)); \
	SAVED=$$(( PRE - POST )); \
	PCT=$$(awk "BEGIN{printf \"%.1f\", $$SAVED * 100 / $$PRE}"); \
	echo "wasm-opt: $$PRE → $$POST bytes  (-$$SAVED bytes, -$$PCT%)"
	cp $(STREAMING_OPT) $(STREAMING_WASM)

clean:
	cargo clean
