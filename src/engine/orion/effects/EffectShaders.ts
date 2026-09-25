/**
 * GLSL for the effects batch. Every particle is one instanced quad; the vertex shader orients
 * it by kind and the fragment shader draws it procedurally from scrolling noise:
 *
 * - flame:  an upright tongue, eaten away at the edges by rising turbulence and coloured by
 *           temperature along a blackbody ramp (deep red, orange, yellow, a pale core). Output
 *           is HDR, so the bloom pass gives it a real glow. Flames that carry soot (an
 *           explosion's fireball) darken into smoke as they cool.
 * - smoke:  a billow lit by the sun with wrap lighting, darker in its core, lit orange from
 *           underneath while it is still close to the fire.
 * - spark:  a hot streak stretched along its direction of travel.
 * - scorch: soot on the road, flat on the ground, with embers glowing while it's fresh.
 * - fireball: an explosion's rolling ball of burning gas, cooling from the edges inward into
 *             black soot, so the blast turns into its own smoke cloud.
 *
 * Everything outputs premultiplied alpha, so one blend mode covers both glowing (colour with
 * no coverage) and occluding (smoke) sprites, and they can be depth-sorted as one batch.
 */

export const EFFECT_VERTEX_GLSL = /* glsl */ `
	attribute vec3 vertex_position;
	attribute vec4 aPositionSize;
	attribute vec4 aAgeSeedRotationKind;
	attribute vec4 aVelocityIntensity;
	attribute vec4 aToneGlow;

	uniform mat4 matrix_viewProjection;
	uniform mat4 matrix_view;
	uniform vec3 view_position;
	uniform vec3 uSunDirection;

	varying vec2 vUv;
	varying vec4 vParams;
	varying vec4 vShade;
	varying vec3 vSun;
	varying vec2 vUp;

	void main(void) {
		vec2 corner = vertex_position.xy;
		vec3 centre = aPositionSize.xyz;
		float size = aPositionSize.w;
		float rotation = aAgeSeedRotationKind.z;
		float kind = aAgeSeedRotationKind.w;

		vec3 cameraRight = vec3(matrix_view[0][0], matrix_view[1][0], matrix_view[2][0]);
		vec3 cameraUp = vec3(matrix_view[0][1], matrix_view[1][1], matrix_view[2][1]);
		vec3 towardCamera = vec3(matrix_view[0][2], matrix_view[1][2], matrix_view[2][2]);

		vec3 right = cameraRight;
		vec3 up = cameraUp;
		vec2 extent = vec2(size);
		vec2 local = corner;

		if (kind < 0.5) {
			// Flame: stands upright however the camera tilts, taller than it is wide, and its
			// base sits on the emitter rather than being centred on it.
			vec3 level = vec3(cameraRight.x, 0.0, cameraRight.z);
			right = length(level) > 0.001 ? normalize(level) : cameraRight;
			up = vec3(0.0, 1.0, 0.0);
			float sway = sin(rotation) * 0.18;
			local = vec2(corner.x + corner.y * sway, corner.y);
			extent = vec2(size, size * 1.6);
			centre.y += size * 1.1;
		} else if (kind < 1.5) {
			float c = cos(rotation);
			float s = sin(rotation);
			local = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
		} else if (kind < 2.5) {
			// Spark: a streak along its velocity as seen from the camera.
			vec3 velocity = aVelocityIntensity.xyz;
			vec3 across = velocity - towardCamera * dot(velocity, towardCamera);
			float speed = length(across);
			if (speed > 0.001) {
				up = across / speed;
				right = normalize(cross(up, towardCamera));
			}
			extent = vec2(size, size + min(speed * 0.035, 0.6));
		} else if (kind < 3.5) {
			// Scorch: flat on the ground, turned by its rotation.
			float c = cos(rotation);
			float s = sin(rotation);
			right = vec3(c, 0.0, s);
			up = vec3(-s, 0.0, c);
		} else {
			// Fireball: a rotated, camera-facing billow like smoke.
			float c = cos(rotation);
			float s = sin(rotation);
			local = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
		}

		vec3 world = centre + right * (local.x * extent.x) + up * (local.y * extent.y);
		gl_Position = matrix_viewProjection * vec4(world, 1.0);

		vUv = corner;
		vParams = aAgeSeedRotationKind;
		// Sprites that reach the lens would fill the screen with one flat smear; fade them out.
		float nearFade = abs(kind - 3.0) < 0.5 ? 1.0 : smoothstep(0.6, 2.2, distance(world, view_position));
		vShade = vec4(aToneGlow.x, aToneGlow.y, aVelocityIntensity.w * nearFade, 0.0);
		// Directions in the sprite's own texture frame, which turns with a rotated puff.
		vSun = vec3(dot(uSunDirection, right), dot(uSunDirection, up), dot(uSunDirection, towardCamera));
		vUp = vec2(right.y, up.y);
		if ((kind > 0.5 && kind < 1.5) || kind > 3.5) {
			float c = cos(rotation);
			float s = sin(rotation);
			vSun.xy = vec2(vSun.x * c + vSun.y * s, -vSun.x * s + vSun.y * c);
			vUp = vec2(vUp.x * c + vUp.y * s, -vUp.x * s + vUp.y * c);
		}
	}
`;

export const EFFECT_FRAGMENT_GLSL = /* glsl */ `
	#include "gammaPS"
	#include "tonemappingPS"
	#include "fogPS"

	uniform sampler2D uNoise;
	uniform float uTime;
	uniform vec3 uSunColour;
	uniform vec3 uAmbient;

	varying vec2 vUv;
	varying vec4 vParams;
	varying vec4 vShade;
	varying vec3 vSun;
	varying vec2 vUp;

	vec4 noiseAt(vec2 uv) {
		return texture2D(uNoise, uv);
	}

	// Temperature to colour, roughly along a blackbody curve.
	vec3 fireColour(float heat) {
		vec3 colour = vec3(0.5, 0.05, 0.01);
		colour = mix(colour, vec3(1.0, 0.25, 0.03), smoothstep(0.04, 0.32, heat));
		colour = mix(colour, vec3(1.0, 0.56, 0.12), smoothstep(0.32, 0.66, heat));
		colour = mix(colour, vec3(1.0, 0.86, 0.55), smoothstep(0.66, 1.05, heat));
		return colour;
	}

	void main(void) {
		vec2 uv = vUv;
		float age = vParams.x;
		float seed = vParams.y;
		float kind = vParams.w;
		float tone = vShade.x;
		float glow = vShade.y;
		float intensity = vShade.z;

		vec3 colour = vec3(0.0);
		float alpha = 0.0;

		if (kind < 0.5) {
			// Flame tongue: height 0 at the base, 1 at the tip.
			float height = clamp(uv.y * 0.5 + 0.5, 0.0, 1.0);
			vec2 flow = vec2(seed * 3.7, seed * 1.9 - uTime * 1.3 - age * 0.9);
			float broad = noiseAt(uv * vec2(0.45, 0.32) + flow).r;
			float fine = noiseAt(uv * vec2(0.9, 0.65) + vec2(seed * 5.3, -uTime * 2.6)).g;
			float turbulence = broad * 0.6 + fine * 0.4;
			// Licks sideways more the higher it goes, and narrows to a ragged tip.
			float x = uv.x + (turbulence - 0.5) * 0.8 * height;
			float width = mix(1.0, 0.22, height);
			float body = 1.0 - abs(x) / width;
			float density = body * 1.35 - height * 0.4 + (turbulence - 0.5) * 1.2;
			density *= smoothstep(-1.0, -0.75, uv.y);
			// A crisp edge: gas either burns or it doesn't, there's no dim halo around a flame.
			density = smoothstep(0.05, 0.6, density);
			float life = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.5, 1.0, age));
			// Hottest at the root of each tongue, cooling towards the tip.
			float heat = density * life * intensity * mix(0.95, 0.55, height);
			// Explosion fireballs leave soot behind as they cool.
			float soot = tone * smoothstep(0.3, 0.85, age) * clamp(density * 1.6, 0.0, 1.0);
			vec3 emission = fireColour(heat) * (heat * 0.9 + heat * heat * heat * 2.6) * (1.0 - soot);
			vec3 sootColour = vec3(0.03, 0.027, 0.025) * (uAmbient + uSunColour * 0.25);
			alpha = clamp(heat * 0.3 + soot * 0.85, 0.0, 1.0);
			colour = emission + sootColour * soot;
		} else if (kind < 1.5) {
			float radius = length(uv);
			vec2 drift = vec2(seed * 7.3, seed * 2.9 - age * 0.3);
			float broad = noiseAt(uv * 0.38 + drift).r;
			float medium = noiseAt(uv * 0.75 + vec2(seed * 3.1, age * 0.45 + uTime * 0.03)).g;
			float fine = noiseAt(uv * 1.5 + vec2(seed * 1.7, -uTime * 0.05)).b;
			float n = broad * 0.55 + medium * 0.3 + fine * 0.15;
			float density = clamp((1.0 - radius) * 1.55 + (n - 0.55) * 1.35, 0.0, 1.0);
			density = density * density * (3.0 - 2.0 * density);
			float fade = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.5, 1.0, age));
			alpha = density * fade * intensity;

			// A rounded billow whose surface is roughened by the noise, lit with wrap lighting
			// so the shadowed side isn't black.
			vec3 normal = normalize(vec3(uv * 0.85 + (vec2(broad, medium) - 0.5) * 0.9, 0.55 + sqrt(max(0.0, 1.0 - radius * radius))));
			vec3 sun = normalize(vSun);
			float diffuse = clamp(dot(normal, sun) * 0.6 + 0.4, 0.0, 1.0);
			// Thin wisps let light through; the dense core self-shadows.
			float selfShadow = mix(1.0, 0.55, density * (1.0 - n));
			// Pale steam through to the near-black soot of burning rubber and plastic.
			vec3 albedo = mix(vec3(0.6, 0.6, 0.62), vec3(0.028, 0.026, 0.024), tone);
			vec3 lit = albedo * (uAmbient + uSunColour * diffuse * selfShadow);
			float underside = smoothstep(0.35, -0.9, dot(uv, vUp) / max(length(vUp), 0.001));
			lit += vec3(1.0, 0.36, 0.07) * glow * (1.0 - smoothstep(0.0, 0.3, age)) * underside * 1.4;
			colour = lit * alpha;
		} else if (kind < 2.5) {
			float core = exp(-uv.x * uv.x * 7.0) * (1.0 - smoothstep(0.25, 1.0, abs(uv.y)));
			vec3 hot = mix(vec3(1.0, 0.82, 0.5), vec3(1.0, 0.32, 0.05), smoothstep(0.15, 0.85, age));
			colour = hot * core * intensity * (1.0 - smoothstep(0.55, 1.0, age)) * 7.0;
			alpha = 0.0;
		} else if (kind < 3.5) {
			float radius = length(uv);
			float n = noiseAt(uv * 0.55 + vec2(seed * 3.0, seed * 5.0)).r;
			float density = clamp((1.0 - radius) * 1.7 + (n - 0.5) * 1.3, 0.0, 1.0);
			density = density * density * (3.0 - 2.0 * density);
			float fade = smoothstep(0.0, 0.01, age) * (1.0 - smoothstep(0.8, 1.0, age));
			alpha = density * 0.88 * fade * intensity;
			colour = vec3(0.012, 0.011, 0.01) * alpha;
			float embers = smoothstep(0.64, 0.82, noiseAt(uv * 1.3 + seed).b) * (1.0 - smoothstep(0.0, 0.06, age)) * density;
			colour += vec3(1.0, 0.24, 0.03) * embers * 2.5;
		} else {
			float radius = length(uv);
			vec2 drift = vec2(seed * 5.1, seed * 3.3 - age * 0.5);
			float broad = noiseAt(uv * 0.4 + drift).r;
			float medium = noiseAt(uv * 0.8 + vec2(seed * 2.3, -uTime * 0.4)).g;
			float n = broad * 0.65 + medium * 0.35;
			float density = clamp((1.0 - radius) * 1.6 + (n - 0.55) * 1.4, 0.0, 1.0);
			density = density * density * (3.0 - 2.0 * density);
			// Burns hot at first, then cools from its thin edges inwards into soot.
			float cooling = smoothstep(0.0, 0.7, age + (1.0 - density) * 0.35 + (0.5 - n) * 0.3);
			float heat = density * (1.0 - cooling) * intensity;
			float fade = 1.0 - smoothstep(0.65, 1.0, age);
			vec3 emission = fireColour(heat) * (heat * 1.1 + heat * heat * heat * 2.4);
			float soot = density * cooling * fade;
			vec3 sootColour = vec3(0.03, 0.028, 0.026) * (uAmbient + uSunColour * 0.5);
			alpha = clamp(soot * 0.92 + heat * 0.35, 0.0, 1.0) * smoothstep(0.0, 0.03, age);
			colour = emission * fade + sootColour * soot;
		}

		#if (FOG != NONE)
			// Premultiplied: fog tints what the sprite covers, and dims what it adds on top.
			float fogFactor = getFogFactor();
			colour = colour * fogFactor + fog_color * alpha * (1.0 - fogFactor);
		#endif

		if (alpha <= 0.002 && dot(colour, vec3(1.0)) <= 0.002) discard;
		gl_FragColor = vec4(gammaCorrectOutput(toneMap(colour)), alpha);
	}
`;
