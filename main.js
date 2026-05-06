const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl) {
    alert('WebGL not supported');
}

// Vertex shader source
const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
    }
`;

// Fragment shader source
const fragmentShaderSource = `
    precision mediump float;
    uniform sampler2D u_texture;
    uniform vec2 u_texScale;
    varying vec2 v_texCoord;
    void main() {
        gl_FragColor = texture2D(u_texture, v_texCoord * u_texScale);
    }
`;

// Create shader function
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Error compiling shader:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// Create program function
function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Error linking program:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

// Create shaders
const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

// Create program
const program = createProgram(gl, vertexShader, fragmentShader);

// Get attribute locations
const positionAttributeLocation = gl.getAttribLocation(program, 'a_position');
const texCoordAttributeLocation = gl.getAttribLocation(program, 'a_texCoord');

// Get uniform locations
const textureUniformLocation = gl.getUniformLocation(program, 'u_texture');
const texScaleLocation = gl.getUniformLocation(program, 'u_texScale');

// Load texture function
function loadTexture(gl, url, callback, flipY = false) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Placeholder magenta
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 255, 255]));
    const image = new Image();
    image.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        if (flipY) {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        callback(image.width, image.height);
    };
    image.src = url;
    return texture;
}

// Load textures
let grassWidth = 64, grassHeight = 64; // default
const grassTexture = loadTexture(gl, 'media/tile-grass.png', (w, h) => {
    grassWidth = w;
    grassHeight = h;
}, true); // flip Y for grass

let fieldWidth = 100, fieldHeight = 100; // default
const fieldTexture = loadTexture(gl, 'media/field.png', (w, h) => {
    fieldWidth = w;
    fieldHeight = h;
    // object size fixed to tile size
}, false); // no flip for field

// Grid properties
const gridCols = 16;
const gridRows = 9;
const gridSizeX = 2 / gridCols; // 0.125
const gridSizeY = 2 / gridRows; // ~0.222

// Tray properties
const trayCols = [14, 15];

// Icon properties (in tray, at col 14, row 4)
const iconCol = 14;
const iconRow = 4;
const iconX = -1 + gridSizeX / 2 + iconCol * gridSizeX;
const iconY = -1 + gridSizeY / 2 + iconRow * gridSizeY;

// Fields
let fields = [{ x: -1 + gridSizeX / 2, y: -1 + gridSizeY / 2 }]; // start with one
let occupied = new Set(); // col,row

// Object size (tile size)
const objectWidth = gridSizeX;
const objectHeight = gridSizeY;

// Buffers
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

const texCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

const objectPositionBuffer = gl.createBuffer();
const objectTexCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, objectTexCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

// Helper functions
function getCol(x) { return Math.round((x + 1) / gridSizeX - 0.5); }
function getRow(y) { return Math.round((y + 1) / gridSizeY - 0.5); }
function getKey(col, row) { return `${col},${row}`; }
function isInTray(col) { return trayCols.includes(col); }
function snapToCenter(x, y) {
    const offsetX = -1 + gridSizeX / 2;
    const offsetY = -1 + gridSizeY / 2;
    const snappedX = offsetX + Math.round((x - offsetX) / gridSizeX) * gridSizeX;
    const snappedY = offsetY + Math.round((y - offsetY) / gridSizeY) * gridSizeY;
    return { x: snappedX, y: snappedY };
}

// Mouse handling
let draggingFieldIndex = -1;
let draggingIcon = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let originalKey = '';
let moved = false;

canvas.addEventListener('mousedown', (e) => {
    moved = false;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const displayedWidth = rect.width;
    const displayedHeight = rect.height;
    const glX = (mouseX / displayedWidth) * 2 - 1;
    const glY = 1 - (mouseY / displayedHeight) * 2;

    // Check fields
    for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        if (glX >= f.x - objectWidth / 2 && glX <= f.x + objectWidth / 2 &&
            glY >= f.y - objectHeight / 2 && glY <= f.y + objectHeight / 2) {
            draggingFieldIndex = i;
            dragOffsetX = glX - f.x;
            dragOffsetY = glY - f.y;
            originalKey = getKey(getCol(f.x), getRow(f.y));
            return;
        }
    }

    // Check icon
    if (glX >= iconX - objectWidth / 2 && glX <= iconX + objectWidth / 2 &&
        glY >= iconY - objectHeight / 2 && glY <= iconY + objectHeight / 2) {
        draggingIcon = true;
        tempField = { x: glX, y: glY };
        dragOffsetX = 0; // since temp starts at mouse
        dragOffsetY = 0;
    }
});

let tempField = null;

canvas.addEventListener('mousemove', (e) => {
    if (draggingFieldIndex >= 0) {
        moved = true;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const displayedWidth = rect.width;
        const displayedHeight = rect.height;
        const glX = (mouseX / displayedWidth) * 2 - 1;
        const glY = 1 - (mouseY / displayedHeight) * 2;
        fields[draggingFieldIndex].x = glX - dragOffsetX;
        fields[draggingFieldIndex].y = glY - dragOffsetY;
        // Clamp
        fields[draggingFieldIndex].x = Math.max(-1 + objectWidth / 2, Math.min(1 - objectWidth / 2, fields[draggingFieldIndex].x));
        fields[draggingFieldIndex].y = Math.max(-1 + objectHeight / 2, Math.min(1 - objectHeight / 2, fields[draggingFieldIndex].y));
    } else if (draggingIcon && tempField) {
        moved = true;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const displayedWidth = rect.width;
        const displayedHeight = rect.height;
        const glX = (mouseX / displayedWidth) * 2 - 1;
        const glY = 1 - (mouseY / displayedHeight) * 2;
        tempField.x = glX - dragOffsetX;
        tempField.y = glY - dragOffsetY;
        // Clamp
        tempField.x = Math.max(-1 + objectWidth / 2, Math.min(1 - objectWidth / 2, tempField.x));
        tempField.y = Math.max(-1 + objectHeight / 2, Math.min(1 - objectHeight / 2, tempField.y));
    }
});

canvas.addEventListener('mouseup', () => {
    if (draggingFieldIndex >= 0) {
        if (!moved) {
            // Click to delete
            const key = getKey(getCol(fields[draggingFieldIndex].x), getRow(fields[draggingFieldIndex].y));
            occupied.delete(key);
            fields.splice(draggingFieldIndex, 1);
        } else {
            // Drag end
            const f = fields[draggingFieldIndex];
            const snapped = snapToCenter(f.x, f.y);
            const col = getCol(snapped.x);
            const row = getRow(snapped.y);
            const key = getKey(col, row);
            if (isInTray(col)) {
                occupied.delete(originalKey);
                fields.splice(draggingFieldIndex, 1);
            } else if (key !== originalKey && occupied.has(key)) {
                // Revert to original position
                const origCol = parseInt(originalKey.split(',')[0]);
                const origRow = parseInt(originalKey.split(',')[1]);
                f.x = -1 + gridSizeX / 2 + origCol * gridSizeX;
                f.y = -1 + gridSizeY / 2 + origRow * gridSizeY;
            } else {
                if (key !== originalKey) {
                    occupied.delete(originalKey);
                    occupied.add(key);
                }
                f.x = snapped.x;
                f.y = snapped.y;
            }
        }
        draggingFieldIndex = -1;
    } else if (draggingIcon && tempField) {
        if (moved) {
            const snapped = snapToCenter(tempField.x, tempField.y);
            const col = getCol(snapped.x);
            const row = getRow(snapped.y);
            const key = getKey(col, row);
            if (!isInTray(col) && !occupied.has(key)) {
                fields.push({ x: snapped.x, y: snapped.y });
                occupied.add(key);
            }
        }
        draggingIcon = false;
        tempField = null;
    }
});

canvas.focus();

// Render function
function render() {
    if (!grassWidth || !fieldWidth) {
        requestAnimationFrame(render);
        return;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(program);

    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.enableVertexAttribArray(texCoordAttributeLocation);

    // Draw background
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, grassTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.uniform1i(textureUniformLocation, 0);
    gl.uniform2f(texScaleLocation, gridCols, gridRows);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Draw fields
    gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform2f(texScaleLocation, 1, 1);
    for (const f of fields) {
        const positions = [
            f.x - objectWidth / 2, f.y - objectHeight / 2,
            f.x + objectWidth / 2, f.y - objectHeight / 2,
            f.x - objectWidth / 2, f.y + objectHeight / 2,
            f.x + objectWidth / 2, f.y + objectHeight / 2,
        ];
        gl.bindBuffer(gl.ARRAY_BUFFER, objectPositionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, objectTexCoordBuffer);
        gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Draw tempField if dragging icon
    if (draggingIcon && tempField) {
        const positions = [
            tempField.x - objectWidth / 2, tempField.y - objectHeight / 2,
            tempField.x + objectWidth / 2, tempField.y - objectHeight / 2,
            tempField.x - objectWidth / 2, tempField.y + objectHeight / 2,
            tempField.x + objectWidth / 2, tempField.y + objectHeight / 2,
        ];
        gl.bindBuffer(gl.ARRAY_BUFFER, objectPositionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, objectTexCoordBuffer);
        gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Draw icon
    const iconPositions = [
        iconX - objectWidth / 2, iconY - objectHeight / 2,
        iconX + objectWidth / 2, iconY - objectHeight / 2,
        iconX - objectWidth / 2, iconY + objectHeight / 2,
        iconX + objectWidth / 2, iconY + objectHeight / 2,
    ];
    gl.bindBuffer(gl.ARRAY_BUFFER, objectPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(iconPositions), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, objectTexCoordBuffer);
    gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(render);
}

render();