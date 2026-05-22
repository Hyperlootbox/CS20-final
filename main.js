let canvas = document.getElementById('canvas')
let ctx = canvas.getContext('2d')

function exposeObject(source, target = globalThis) {
    if (source == null || target == null) return target

    source = Object(source)
    target = Object(target)
    let seen = new Set()
    for (let proto = source; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
        for (let key of Object.getOwnPropertyNames(proto)) {
            if (key == 'constructor' || seen.has(key)) continue
            seen.add(key)

            let targetDescriptor = Object.getOwnPropertyDescriptor(target, key)
            if (targetDescriptor && !targetDescriptor.configurable) continue

            let descriptor = Object.getOwnPropertyDescriptor(proto, key)
            if (!descriptor) continue

            if ('value' in descriptor && typeof descriptor.value == 'function') {
                Object.defineProperty(target, key, {
                    value: source[key].bind(source),
                    writable: true,
                    configurable: true
                })
            } else {
                Object.defineProperty(target, key, {
                    get() {
                        return source[key]
                    },
                    set(value) {
                        source[key] = value
                    },
                    configurable: true
                })
            }
        }
    }

    return target
}

exposeObject(ctx)
exposeObject(Math)
let gravity = { x: 0, y: -0.25 }
let wind = { vx: 0, vy: 0, drag: 0.001 }
const pi = PI
Object.defineProperty(window, 'time', { get() { return performance.now() } })
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

let scrollx = 0;
let scrolly = 0;
let screen = { left: 0, right: 0, up: 0, down: 0 }
let zoom = 1;
let scrollLimits = {
    zoomMin: 1 / 2,
    zoomMax: 2,
    left: -10000,
    right: 10000,
    up: 10000,
    down: -10000
}
let levelStats = {
    collectedBalls: 0,
    minBalls: 0,
    startTime: 0,
    moves: 0,
    targetMoves: 0,
    targetBalls: 0,
    targetTime: 0,
}
let zoomMin = 1 / 2
let zoomMax = 2
function scroll(relative = false) {
    if (relative) {
        transform(zoom, 0, 0, -zoom, -scrollx * zoom + canvas.width * zoom / 2, scrolly * zoom + canvas.height * zoom / 2);
    } else {
        setTransform(zoom, 0, 0, -zoom, -scrollx * zoom + canvas.width * zoom / 2, scrolly * zoom + canvas.height * zoom / 2);
    }
}
function worldToScreen(x, y) {
    return { x: x * zoom - scrollx * zoom + canvas.width * zoom / 2, y: -y * zoom + scrolly * zoom + canvas.height * zoom / 2 }
}
function screenToWorld(x, y) {
    return { x: (x + scrollx * zoom - canvas.width * zoom / 2) / zoom, y: -(y - scrolly * zoom - canvas.height * zoom / 2) / zoom };
}
function centerCameraOn(x, y) {
    let center = screenToWorld(canvas.width / 2, canvas.height / 2)
    scrollx += x - center.x
    scrolly += y - center.y
}
function smoothCameraTo(sx, sy, fx, fy, st, ft, sz = zoom, fz = sz) {
    let t = clamp((ticks - st) / (ft - st), 0, 1)
    t = t * t * t * (t * (t * 6 - 15) + 10)
    let steepness = 4
    let min = atan(-steepness / 2)
    let max = atan(steepness / 2)
    t = (atan(steepness * (t - 0.5)) - min) / (max - min)
    zoom = sz + (fz - sz) * t
    centerCameraOn(sx + (fx - sx) * t, sy + (fy - sy) * t)
}
function dist(a, b, c = 0, d = 0) {
    return norm(a, b, c, d) ** 0.5
}
function norm(a, b, c = 0, d = 0) {
    return sq(a - c) + sq(b - d)
}
function sq(a) {
    return a * a
}
function clamp(value, lower, upper) {
    return max(lower, min(upper, value))
}
function clampScroll() {
    let topleft = screenToWorld(0, 0)
    let bottomright = screenToWorld(canvas.width, canvas.height)
    if (topleft.x < scrollLimits.left) scrollx = scrollLimits.left + canvas.width / 2
    if (bottomright.x > scrollLimits.right) scrollx = scrollLimits.right + canvas.width / 2 - canvas.width / zoom
    if (topleft.y > scrollLimits.up) scrolly = scrollLimits.up - canvas.height / 2
    if (bottomright.y < scrollLimits.down) scrolly = scrollLimits.down + canvas.height / zoom - canvas.height / 2
}
function clampedScrollAtZoom(x, y, atZoom) {
    let minx = scrollLimits.left + canvas.width / 2
    let maxx = scrollLimits.right + canvas.width / 2 - canvas.width / atZoom
    let miny = scrollLimits.down + canvas.height / atZoom - canvas.height / 2
    let maxy = scrollLimits.up - canvas.height / 2

    if (minx > maxx) x = (minx + maxx) / 2
    else x = clamp(x, minx, maxx)
    if (miny > maxy) y = (miny + maxy) / 2
    else y = clamp(y, miny, maxy)

    return { x, y }
}
let pointProjSegmentReturn = { x: 0, y: 0, t: 0 }
function pointProjSegment(x, y, x1, y1, x2, y2) {
    let t = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / norm(x1, y1, x2, y2)
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    pointProjSegmentReturn.x = x1 + t * (x2 - x1)
    pointProjSegmentReturn.y = y1 + t * (y2 - y1)
    pointProjSegmentReturn.t = t
    return pointProjSegmentReturn
}
function randfloat(...args) {
    if (args.length == 1) {
        return random() * args[0]
    }
    if (args.length == 2) {
        return random() * (args[1] - args[0]) + args[0]
    }
}
function randint(...args) {
    return floor(randfloat(...args))
}
function randchoice(arr) {
    return arr[randint(arr.length)]
}
function transferBound(from, to) {
    to.left = from.left
    to.right = from.right
    to.up = from.up
    to.down = from.down
}
function iterRun(iterable, method) {
    for (let i = 0; i < iterable.length; i++) {
        if (iterable[i][method]()) i--
    }
}
function updateScreen() {
    let topleft = screenToWorld(0, 0)
    let bottomright = screenToWorld(canvas.width, canvas.height)
    screen.left = topleft.x
    screen.up = topleft.y
    screen.right = bottomright.x
    screen.down = bottomright.y
}
function text(text, x, y, size) {
    beginPath()
    font = `700 ${size}px Ubuntu, sans-serif`
    fillStyle = '#fff'
    strokeStyle = '#000'
    lineWidth = size / 25
    fillText(text, x, y)
    strokeText(text, x, y)
}

function formatTime(ms) {
    let total = Math.floor(ms / 1000)
    let seconds = total % 60
    let minutes = Math.floor(total / 60) % 60
    let hours = Math.floor(total / 3600)

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`
}
function scene() {
    updateScreen()
    if (level == 1 && ticks <= 7200) {
        smoothCameraTo(50, 400, 50, 150, 900, 6300, 2)
        return true
    }
    if (level == 2 && ticks < 14000) {
        if (ticks < 6300) {
            smoothCameraTo(1000, -250, 1200, 100, 900, 6300, 2)
        } else {
            smoothCameraTo(1200, 100, 100, 50, 7200, 13000, 2, 1.5)
        }
        return true
    }
    if (level == 3 && ticks < 16000) {
        if (ticks < 6300) {
            smoothCameraTo(0, 0, 0, -500, 900, 6300, 2)
        } else if (ticks < 11000) {
            smoothCameraTo(0, -500, 0, 400, 7200, 11000, 2)
        } else {
            smoothCameraTo(0, 400, 0, 0, 11000, 16000, 2, 1.5)
        }
        return true
    }
    if (level == 4 && ticks < 6300) {
        smoothCameraTo(127, 500, 127, 100, 900, 6300, 2, 1.5)
        return true
    }
    if (level == 5 && ticks < 6300) {
        smoothCameraTo(0, 700, 0, 0, 900, 6300, 2, 1.5)
        return true
    }
    if (level == 6 && ticks < 6300) {
        if (ticks < 3600) {
            smoothCameraTo(0, -150, 0, -150, 0, 1, 1.2, 1.2)
        } else {
            smoothCameraTo(0, -150, 0, -300, 3600, 6300, 1.2, 1.5)
        }
        return true
    }
    if (level == 7 && ticks <= 14000) {
        if (ticks<6300) {
            smoothCameraTo(0, 100, 0, 1800, 1800, 6300, 1)
        } else {
            smoothCameraTo(0, 1800, 0, 100, 6300, 14000, 1)
        }
        return true
    }
    return false
}

let fpsLimit = 60
let nextFrame = time
let ticksPerSecond = 1800;
let dt = 60 / ticksPerSecond
let simulationSpeed = 0
let ticksThisSecond = 0
let ticks = 0
let isScene = false

function gameAnimationFrame() {
    continueBtn.tick()
    isScene = scene()
    let m = isScene && mouse[0] ? 5 : 1
    for (let i = 0; i < ticksPerSecond / fpsLimit * m; i++) {
        ticks++
        ticksThisSecond++
        iterRun(surfaces, 'tick')
        iterRun(balls, 'addBoundingBox')
        iterRun(surfaces, 'addBoundingBox')
        iterRun(connections, 'addBoundingBox')
        iterRun(saws, 'addBoundingBox')
        if (pipe) pipe.tick()
        iterRun(balls, 'calculateForces')
        iterRun(balls, 'move')
        refreshSuckedStructure()
        if (time > nextFrame) { break }
    }
    if (pipe) pipe.draw()
    iterRun(saws, 'draw')
    iterRun(walls, 'draw')
    iterRun(connections, 'draw')
    mouse.drawConnections()
    iterRun(balls, 'draw')
    iterRun(floatingTexts, 'tick')
    iterRun(floatingTexts, 'draw')
    continueBtn.draw()
    menuBtn.tick()
    !isScene && menuBtn.draw()
    sceneCovers.draw(isScene)
    if (!isScene) {
        resetTransform()
        save()
        textAlign = 'right'
        text(floor(simulationSpeed * 100) + "%", canvas.width, canvas.height - 17, 30)
        textAlign = 'left'
        text("Collected: " + levelStats.collectedBalls + "/" + levelStats.minBalls, 0, canvas.height - 17, 45)
        restore()
    }
    if (gameState == 'completed' && completeScreen) {
        completeScreen.tick()
        completeScreen && completeScreen.draw()
    }
}
let sceneCovers = {
    height: 0, draw(on) {
        save()
        let target = on ? 50 : 0
        this.height += (target - this.height) / 10
        if (on) this.height = target
        fillStyle = '#000'
        fillRect(0, 0, canvas.width, this.height)
        fillRect(0, canvas.height - this.height, canvas.width, this.height)
        restore()
    }
}

function animationFrame() { // raf
    save()
    resetTransform();
    fillStyle = '#999'
    fillRect(0, 0, canvas.width, canvas.height);
    restore()
    if ((mouse[1] || mouse[0] && !mouse.draggedBall && !mouse.draggedBall) && gameState == 'active') {
        scrollx -= (mouse.sx - mouse.last.x) / zoom
        scrolly += (mouse.sy - mouse.last.y) / zoom
        clampScroll()
        updateScreen()
    }
    while (nextFrame < time) nextFrame += 1000 / fpsLimit
    !isScene && mouse.tick()
    if (gameState == 'active' || gameState == 'completed') {
        gameAnimationFrame()
    }
    if (gameState == 'distinctions') {
        distinctionPage.tick()
        distinctionPage.draw()
    }
    !isScene && mouse.draw()
    mouse.updateLast()
    if (time < nextFrame) {
        setTimeout(animationFrame, nextFrame - time)
    } else {
        requestAnimationFrame(animationFrame)
    }
}
document.fonts.ready.then(() => requestAnimationFrame(animationFrame))
setInterval(_ => {
    simulationSpeed = ticksThisSecond / ticksPerSecond
    ticksThisSecond = 0
}, 1000)
let boundingBoxes = {}
let boundingBoxSize = 50
let balls = []
let seenId = 0
let ballStats = {
    'black': { size: 16, mass: 10, maxConnectionLen: 150, maxConnections: 2, minConnections: 2, detachable: false, connectionStrength: 2.5, connectionDamp: 1.5 },
    'white': { size: 17, mass: 12, maxConnectionLen: 150, maxConnections: 4, minConnections: 2, detachable: false, connectionStrength: 3.5, connectionDamp: 2.5 },
    'green': { size: 16, mass: 8, maxConnectionLen: 150, maxConnections: 3, minConnections: 2, detachable: true, connectionStrength: 2.5, connectionDamp: 1.5 },
    'steel': { size: 16, mass: 20, maxConnectionLen: 200, maxConnections: 10, minConnections: 2, detachable: false, connectionStrength: 50, connectionDamp: 50 },
    'pin': { size: 10, mass: 20, maxConnectionLen: 200, maxConnections: 10, minConnections: 1, detachable: false, connectionStrength: 50, connectionDamp: 50 },
}
class Ball {
    constructor(x, y, type = 'black', awake = true) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.vx = 0;
        this.vy = 0;
        this.awake = awake
        let stats = ballStats[type] || ballStats.black
        this.size = stats.size;
        this.mass = stats.mass;
        this.maxConnectionLen = stats.maxConnectionLen
        this.maxConnections = stats.maxConnections
        this.minConnections = stats.minConnections
        this.detachable = stats.detachable
        this.dragged = false;
        this.force = { x: 0, y: 0 }
        this.bound = { left: 0, right: 0, up: 0, down: 0 }
        this.lastBound = { left: 0, right: 0, up: 0, down: 0 }
        this.tempBound = { left: 0, right: 0, up: 0, down: 0 }
        this.connections = []
        this.structureMove = {}
        this.autoMove = {}
        this.suckPath = null;
        this.surfaceStick = null
        this.lastSleepText = randint(0, 1000)
    }
    addBoundingBox() { // Ball.addBoundingBox
        const { x, y, size, bound, lastBound, connections } = this
        transferBound(this.boundsAt(x, y), bound)
        let { left, right, up, down } = bound
        let { left: left1, right: right1, up: up1, down: down1 } = lastBound
        if (left == left1 && right == right1 && up == up1 && down == down1 && mouse.draggedBall != this) return
        this.removeBoundingBox()
        if (mouse.draggedBall == this && !connections.length) {
            lastBound.left = left
            lastBound.right = left
            lastBound.up = down
            lastBound.down = down
            return
        }
        for (let i = left; i < right; i++) {
            for (let j = down; j < up; j++) {
                if (!boundingBoxes[j]) boundingBoxes[j] = {}
                if (!boundingBoxes[j][i]) boundingBoxes[j][i] = new Set()
                boundingBoxes[j][i].add(this)
            }
        }
        transferBound(bound, lastBound)
    }
    boundsAt(x, y) { // Ball.boundsAt
        let { tempBound: bound, size } = this
        let awakeRadius = 0
        if (this.connections.length) {
            awakeRadius = 100
        }
        bound.left = floor((x - size - awakeRadius) / boundingBoxSize)
        bound.right = floor((x + size + awakeRadius) / boundingBoxSize) + 1
        bound.up = floor((y + size + awakeRadius) / boundingBoxSize) + 1
        bound.down = floor((y - size - awakeRadius) / boundingBoxSize)
        return bound
    }
    removeBoundingBox() { // Ball.removeBoundingBox
        let { left: left1, right: right1, up: up1, down: down1 } = this.lastBound
        for (let i = left1; i < right1; i++) {
            for (let j = down1; j < up1; j++) {
                if (!boundingBoxes[j]?.[i]) continue
                boundingBoxes[j][i].delete(this)
                let row = boundingBoxes[j]
                let cell = row?.[i]
                if (!cell) continue
                if (cell.size === 0) {
                    delete row[i]

                    let rowEmpty = true
                    for (let key in row) {
                        rowEmpty = false
                        break
                    }
                    if (rowEmpty) {
                        delete boundingBoxes[j]
                    }
                }
            }
        }
    }
    collidesWithSurfaceAt(x, y) {
        seenId++
        let { left, right, up, down } = this.boundsAt(x, y)
        for (let i = left; i < right; i++) {
            for (let j = down; j < up; j++) {
                let cell = boundingBoxes[j]?.[i]
                if (!cell) continue
                for (let other of cell) {
                    if (other.seen == seenId) continue
                    other.seen = seenId
                    if (other instanceof Surface) {
                        const { x1, y1, x2, y2 } = other
                        let { x: sx, y: sy } = pointProjSegment(x, y, x1, y1, x2, y2)
                        if (norm(x, y, sx, sy) < sq(this.size)) {
                            return true
                        }
                    }
                }
            }
        }
        return false
    }
    inTriangle() { // Ball.inTriangle
        let { x, y } = this
        let triangleRange = 35

        for (let i = 0; i < triangles.length; i++) {
            let { a, b, c } = triangles[i]
            if (!a.connectedTo(b) || !b.connectedTo(c) || !c.connectedTo(a)) {
                triangles.splice(i, 1)
                continue
            }
            let denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
            if (denom == 0) continue
            let alpha = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom
            let beta = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom
            let gamma = 1.0 - alpha - beta;
            let closestAB = pointProjSegment(x, y, a.x, a.y, b.x, b.y)
            let distanceAB = norm(x, y, closestAB.x, closestAB.y)
            let closestBC = pointProjSegment(x, y, b.x, b.y, c.x, c.y)
            let distanceBC = norm(x, y, closestBC.x, closestBC.y)
            let closestCA = pointProjSegment(x, y, c.x, c.y, a.x, a.y)
            let distanceCA = norm(x, y, closestCA.x, closestCA.y)
            if (alpha >= 0 && beta >= 0 && gamma >= 0 || min(distanceAB, distanceBC, distanceCA) <= sq(triangleRange)) {
                return true
            }
        }

        for (let connection of connections) {
            let { a, b } = connection
            let closest = pointProjSegment(x, y, a.x, a.y, b.x, b.y)
            if (norm(x, y, closest.x, closest.y) <= sq(triangleRange)) {
                return true
            }
        }

        return false
    }
    remove() { // Ball.remove
        let { connections } = this
        for (let i = 0; i < balls.length; i++) {
            if (balls[i] == this) {
                balls.splice(i, 1)
            }
        }
        while (connections.length) {
            connections[0].remove()
        }
        this.removeBoundingBox()
    }
    connectedTo(other) { // Ball.connectedTo
        for (let connection of this.connections) {
            if (connection.other(this) == other) return true
        }
        return false
    }
    calculateForces() { // Ball.calculateForces
        const { x, y, vx, vy, size, mass, bound, connections, awake, structureMove, autoMove, type } = this
        if (this.deathTimer) {
            if (time - this.deathTimer > 100) this.remove()
            return
        }
        if (type == 'pin') return
        let dragged = mouse.draggedBall == this && !connections.length
        let force = this.force
        force.x = 0
        force.y = 0

        if (dragged) {
            let followK = 40 * mass
            let followC = 2 * sqrt(followK * mass)

            let mag = max(1e-6, dist(x, y, mouse.x, mouse.y))
            force.x = (mouse.x - x) / mag * followK - vx * followC
            force.y = (mouse.y - y) / mag * followK - vy * followC
        } else if (!structureMove.active) {
            force.x += gravity.x * mass
            force.y += gravity.y * mass
        }
        let onGround = false
        if (structureMove.active) return
        let awakeRadius = 100
        let { left, right, up, down } = bound
        seenId++
        for (let i = left; i < right; i++) {
            for (let j = down; j < up; j++) {
                let cell = boundingBoxes[j]?.[i]
                if (!cell) continue
                for (let other of cell) {
                    if (dragged && !(other instanceof Surface)) continue
                    if (other == this || other.seen == seenId) continue
                    other.seen = seenId

                    if (!this.connections.length && other instanceof Connection && awake) {
                        let { a, b } = other
                        let { x: x1, y: y1 } = a
                        let { x: x2, y: y2 } = b
                        let { x: sx, y: sy, t: t } = pointProjSegment(x, y, x1, y1, x2, y2)

                        let d = dist(x, y, sx, sy)
                        if (size - d <= 0) continue
                        //conservation of momentum
                        a.vx = (t * mass * vx + a.mass * a.vx - t * mass * (a.vx + b.vx) / 2) / a.mass
                        a.vy = (t * mass * vy + a.mass * a.vy - t * mass * (a.vy + b.vy) / 2) / a.mass
                        b.vx = (t * mass * vx + b.mass * b.vx - t * mass * (a.vx + b.vx) / 2) / b.mass
                        b.vy = (t * mass * vy + b.mass * b.vy - t * mass * (a.vy + b.vy) / 2) / b.mass
                        structureMove.active = true
                        structureMove.currentConnection = other
                        if (random() < 0.5) {
                            structureMove.t = t
                            structureMove.previousNode = a
                        } else {
                            structureMove.t = 1 - t
                            structureMove.previousNode = b
                        }
                        return
                    }

                    if (other instanceof Surface) { // surface collision
                        const { x1, y1, x2, y2, vx1, vy1, vx2, vy2, sticky, friction } = other

                        let { x: sx, y: sy, t: t } = pointProjSegment(x, y, x1, y1, x2, y2)
                        let dx = x - sx
                        let dy = y - sy
                        if (sq(size) - norm(x, y, sx, sy) <= 0) continue
                        let surfacevx = vx1 * (1 - t) + vx2 * t
                        let surfacevy = vy1 * (1 - t) + vy2 * t
                        let distance = dist(x, y, sx, sy)
                        let inside = size - distance
                        if (distance == 0) {
                            force.x += random(-1, 1)
                            continue
                        }
                        let nx = dx / distance
                        let ny = dy / distance
                        let rvx = vx - surfacevx
                        let rvy = vy - surfacevy
                        let rv = rvx * nx + rvy * ny
                        let k = mass * 100; // wall stiffness
                        let fnet = max(0, inside * k - 0.5 * (mass * k) ** 0.5 * rv)
                        force.x += fnet * nx
                        force.y += fnet * ny

                        // friction
                        let movement = 0
                        if (!structureMove.active && awake && !connections.length) {
                            if (!autoMove.direction) autoMove.direction = (randint(0, 2) ? 1 : -1)
                            if (ticks > autoMove.nextSwitchDirection) autoMove.direction *= -1
                            if (!autoMove.nextSwitchDirection || ticks > autoMove.nextSwitchDirection) autoMove.nextSwitchDirection = ticks + randint(9000, 90000)
                            movement = autoMove.direction * 2
                        }
                        let fc = friction // friction coefficient
                        let tx = -ny
                        let ty = nx
                        let tv = rvx * tx + rvy * ty
                        let frictionLimit = fc * max(0, fnet) // fnet is the normal force
                        let frictionForce = min(abs(tv) * mass / dt, frictionLimit)
                        force.x -= sign(tv) * frictionForce * tx
                        force.y -= sign(tv) * frictionForce * ty

                        if (connections.length) this.surfaceStick = other
                        onGround = true
                        if (other.id == 'transparent') connections.forEach(k => k.remove())
                    }

                    if (other instanceof Ball && !this.awake && other.connections.length && other.awake && norm(x, y, other.x, other.y) < sq(awakeRadius) && random() < 0.001) {
                        this.awake = true
                        floatingText('!', x + randint(-40, 20), y + randint(15, 25), 30, 2)
                        force.x += 1.2 * (other.x - x) * mass
                        force.y += 200 * mass
                    }
                    if (other instanceof Ball && !structureMove.active && !connections.length && this.awake && this.onGround > 10 && other.connections.length && norm(x, y, other.x, other.y) < sq(awakeRadius) && random() < 0.001) {
                        force.x += 1.2 * (other.x - x) * mass
                        force.y += 200 * mass
                        this.onGround = 0
                    }

                    if (other instanceof Ball && !other.structureMove.active && !other.connections.length == !connections.length) { // ball collisions
                        let dx = x - other.x
                        let dy = y - other.y
                        if (sq(size + other.size) - norm(x, y, other.x, other.y) <= 0) continue
                        let distance = dist(x, y, other.x, other.y)
                        let inside = size + other.size - distance
                        if (distance == 0) {
                            force.x += random(-1, 1)
                            continue
                        }
                        let nx = dx / distance
                        let ny = dy / distance
                        let rvx = vx - other.vx
                        let rvy = vy - other.vy
                        let rv = rvx * nx + rvy * ny
                        let k = 3; // ball stiffness
                        let fnet = max(0, inside * k - 1 * (mass * k) ** 0.5 * rv)
                        force.x += fnet * nx
                        force.y += fnet * ny
                        onGround = true
                    }
                    if (other instanceof Saw) {
                        if (norm(x, y, other.x, other.y) < sq(other.size + size) && !['steel'].includes(this.type)) {
                            this.deathTimer = time
                            return
                        }
                    }
                }
            }
        }

        // connections
        for (let connection of connections) {
            let other = connection.other(this)
            let dx = x - other.x
            let dy = y - other.y
            let distance = dist(x, y, other.x, other.y)
            let stretch = connection.length - distance
            if (stretch / connection.strength > 50) {
                connection.remove();
                continue
            }
            if (distance == 0) {
                force.x += random(-1, 1)
                continue
            }
            let nx = dx / distance
            let ny = dy / distance
            let rvx = vx - other.vx
            let rvy = vy - other.vy
            let rv = rvx * nx + rvy * ny
            let fnet = stretch * connection.strength - connection.damp * rv
            force.x += fnet * nx
            force.y += fnet * ny
        }

        // pipe sucking
        if (pipe) {
            let dx = pipe.x - x
            let dy = pipe.y - y
            let d = dist(dx, dy)
            if (d < pipe.range && pipe.active) {
                let nx = dx / d
                let ny = dy / d
                let f = pipe.strength * d / pipe.range
                force.x += nx * f
                force.y += ny * f
                if (connections.length) {
                    this.suckPath = 'pipe'
                    seenId++
                    this.seen = seenId
                    let q = [this]
                    while (q.length) {
                        let ball = q.splice(0, 1)[0]
                        for (let connection of ball.connections) {
                            let other = connection.other(ball)
                            if (other.seen == seenId) continue
                            other.seen = seenId
                            other.suckPath = connection
                            q.push(other)
                        }
                    }
                } else {
                    if (d < pipe.range / 2 && !mouse.draggedBall == this) {
                        this.pipeSucked = true
                        return
                    }
                }
            } else if (this.suckPath == 'pipe') {

                this.suckPath = null
                seenId++
                this.seen = seenId
                let q = [this]
                while (q.length) {
                    let ball = q.splice(0, 1)[0]
                    for (let connection of ball.connections) {
                        let other = connection.other(ball)
                        if (other.seen == seenId) continue
                        other.seen = seenId
                        other.suckPath = null
                        q.push(other)
                    }
                }
            }
        }



        //air resistance
        let rvx = vx - wind.vx
        let rvy = vy - wind.vy
        let rvmag = dist(rvx, rvy)
        force.x -= wind.drag * rvmag * rvx
        force.y -= wind.drag * rvmag * rvy


        this.force = force
        this.onGround = onGround ? this.onGround + 1 : 0
    }
    escapeWallPath(x, y) {
        let { size } = this
        let samples = [[0, 0], [0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75], [0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5]]
        let inside = (x, y, wall) => {
            let inside = false
            for (let { x1, y1, x2, y2 } of wall.surfaces) {
                if ((y1 > y) != (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside
            }
            return inside
        }
        let count = (x, y, wall) => samples.reduce((n, p) => n + inside(x + p[0] * size, y + p[1] * size, wall), 0)
        let insideAny = (x, y) => walls.some(wall => inside(x, y, wall) || count(x, y, wall) > samples.length / 2)
        let nearest = null
        for (let wall of walls) {
            if (count(x, y, wall) <= samples.length / 2) continue
            for (let surface of wall.surfaces) {
                let p = pointProjSegment(x, y, surface.x1, surface.y1, surface.x2, surface.y2)
                let d = norm(x, y, p.x, p.y)
                if (!nearest || d < nearest.d) nearest = { d, dx: p.x - x, dy: p.y - y, wall, surface }
            }
        }
        if (!nearest) return null
        let { dx, dy } = nearest
        if (nearest.d <= 1e-6) {
            let { x1, y1, x2, y2 } = nearest.surface
            let len = dist(x2 - x1, y2 - y1)
            if (len <= 1e-6) return null
            dx = -(y2 - y1) / len
            dy = (x2 - x1) / len
            if (count(x + dx * size, y + dy * size, nearest.wall) > count(x - dx * size, y - dy * size, nearest.wall)) dx *= -1, dy *= -1
        } else {
            let d = dist(dx, dy)
            dx /= d
            dy /= d
        }
        let step = max(1, size / 4)
        for (let i = 0; i < 2000 && insideAny(x, y); i++) {
            x += dx * step
            y += dy * step
        }
        return insideAny(x, y) ? null : { x, y }
    }
    move() { // Ball.move
        let { x, y, vx, vy, size, mass, force, connections, structureMove, surfaceStick, lastSleepText, awake, type } = this

        if (this.deathTimer || type == 'pin') return

        if (!awake && time > lastSleepText + 1000) {
            this.lastSleepText = time + randint(-500, 0)
        }
        if (time > this.lastSleepText + 500 && !awake) {
            this.lastSleepText = time
            floatingText('z', x + randint(-40, 20), y, 20, 1)
        }

        if (norm(force.x, force.y) < sq(surfaceStick?.sticky || 0)) {
            force.x = 0
            force.y = 0
            vx = 0
            vy = 0
        } else if (surfaceStick) {
            this.surfaceStick = null
        }

        if (mouse.draggedBall == this && !connections.length) {
            let escape = this.escapeWallPath(x, y)
            if (escape) {
                x = escape.x
                y = escape.y
                vx = 0
                vy = 0
            } else {
                let collisionTicks = false
                for (let i = 0; i < 500; i++) {
                    if (this.collidesWithSurfaceAt(x, y)) {
                        collisionTicks = true
                    }
                    let dx = mouse.x - x
                    let dy = mouse.y - y
                    let distance = dist(dx, dy)
                    if (distance <= 1e-6 && !collisionTicks) break

                    if (!collisionTicks) {
                        let step = min(size, distance)
                        let nextx = x + dx / distance * step
                        let nexty = y + dy / distance * step
                        if (!this.collidesWithSurfaceAt(nextx, nexty)) {
                            x = nextx
                            y = nexty
                            continue
                        }
                        collisionTicks = true
                    }

                    let lastx = x
                    let lasty = y
                    this.x = x
                    this.y = y
                    this.vx = vx
                    this.vy = vy
                    this.addBoundingBox()
                    this.calculateForces()
                    force = this.force
                    vx += force.x / mass * dt
                    vy += force.y / mass * dt
                    x += vx * dt
                    y += vy * dt
                    if (norm(x, y, lastx, lasty) < sq(dt / 10)) break
                }
                if (!collisionTicks) {
                    vx = 0
                    vy = 0
                }
            }
        } else if (this.pipeSucked) {
            let dx = pipe.x - x
            let dy = pipe.y - y
            let d = dist(dx, dy)
            vx = dx / d * 10
            vy = dy / d * 10
            x += vx * dt
            y += vy * dt
            if (d < 1) {
                this.remove()
                levelStats.collectedBalls++
                if (levelStats.collectedBalls == levelInfo[level][1]) {
                    pipeText = floatingText('OCD!', pipe.x, pipe.y, 60, 3)
                } else {
                    pipeText = floatingText(levelStats.collectedBalls, pipe.x, pipe.y, 40, 3)
                }
            }
        } else if (structureMove.active) {
            vx = 0
            vy = 0
            if (!structureMove.currentConnection.exists()) {
                structureMove.active = false
            } else {
                let prev = structureMove.previousNode
                let next = structureMove.currentConnection.other(prev)
                let t = structureMove.t
                t += (prev.suckPath ? 0.1 : 0.05) / dist(prev.x, prev.y, next.x, next.y)
                if (t > 1) {
                    structureMove.previousNode = next
                    if (next.suckPath) {
                        if (next.suckPath == 'pipe') {
                            this.pipeSucked = true
                            return
                        }
                        structureMove.currentConnection = next.suckPath
                    } else {
                        let possible = next.connections.sort((c2, c1) => {
                            let b1 = c1.other(next)
                            let b2 = c2.other(next)
                            return norm(b1.x, b1.y, mouse.x, mouse.y) - norm(b2.x, b2.y, mouse.x, mouse.y)
                        })
                        structureMove.currentConnection = possible[parseInt(sqrt(randfloat(sq(possible.length))))]
                    }
                    t--
                    prev = structureMove.previousNode
                    next = structureMove.currentConnection.other(prev)
                }
                x += (prev.x * (1 - t) + next.x * t - x)
                y += (prev.y * (1 - t) + next.y * t - y)

                structureMove.t = t
            }

        } else {
            vx += force.x / mass * dt
            vy += force.y / mass * dt
            x += vx * dt
            y += vy * dt
        }

        this.x = x
        this.y = y
        this.vx = vx
        this.vy = vy
    }
    draw() { // ball.draw
        const { x, y, size, type, deathTimer } = this
        let { left, right, up, down } = screen
        if (x + size < left || x - size > right || y - size > up || y + size < down) return

        save()
        scroll()
        beginPath()
        translate(x, y)
        if (deathTimer) {
            globalAlpha = 1 - (time - deathTimer) / 100
            scale(1 + (time - deathTimer) / 200, 1 + (time - deathTimer) / 200)
        }
        if (type == 'black') {
            arc(0, 0, size, 0, 2 * pi);
            fillStyle = "#111"
            fill()
        }
        if (type == 'white') {
            arc(0, 0, size, 0, 2 * pi);
            fillStyle = '#eee'
            fill();
            beginPath()
            arc(0, 0, size * 0.8, 0, 2 * pi);
            fillStyle = '#fff'
            fill();
        }
        if (type == 'green') {
            arc(0, 0, size, 0, 2 * pi);
            fillStyle = '#00990f'
            fill();
            beginPath()
            arc(0, 0, size * 0.8, 0, 2 * pi);
            fillStyle = '#01a011'
            fill();
        }
        if (type == 'steel') {
            arc(0, 0, size, 0, 2 * pi);
            fillStyle = '#425470'
            fill();
            beginPath()
            arc(0, 0, size * 0.8, 0, 2 * pi);
            fillStyle = '#485b7a'
            fill();
        }
        if (type == 'pin') {
            arc(0, 0, size, 0, 2 * pi);
            fillStyle = '#242424'
            fill();
            beginPath()
            arc(0, 0, size * 0.8, 0, 2 * pi);
            fillStyle = '#2e2e2e'
            fill();
            moveTo(0, size / 2)
            lineTo(0, -size / 2)
            moveTo(size / 2, 0)
            lineTo(-size / 2, 0)
            strokeStyle = '#111'
            lineWidth = size / 5
            stroke()
        }
        restore()
    }
}

function refreshSuckedStructure() {
    seenId++
    for (let ball of balls) {
        if (!ball.connections.length || ball.seen == seenId) continue
        let seen = [ball]
        let q = [ball]
        ball.seen = seenId
        let connected = false
        while (q.length) {
            let ball = q.splice(0, 1)[0]
            if (ball.suckPath == 'pipe') connected = true
            for (let connection of ball.connections) {
                let other = connection.other(ball)
                if (other.seen == seenId) continue
                other.seen = seenId
                q.push(other)
                seen.push(other)
            }
        }
        if (connected == false) {
            for (let ball of seen) {
                ball.suckPath = null
            }
        }
    }
}

function ball(...args) {
    let b = new Ball(...args)
    balls.push(b)
    return b
}

function createSquare(x, y, type = 'black') {
    let square = [ball(x, y, type), ball(x, y + 100, type), ball(x + 100, y, type), ball(x + 100, y + 100, type)]
    for (let i = 0; i < square.length - 1; i++) {
        for (let j = i + 1; j < square.length; j++) {
            connect(square[i], square[j])
        }
    }
}

let connections = []
let triangles = []
class Connection {
    constructor(a, b, ballConnection) {
        this.a = a
        this.b = b
        this.length = dist(a.x, a.y, b.x, b.y)
        this.type = ballConnection?.type || a.type
        this.ballConnection = ballConnection
        let stats = ballStats[this.type] || ballStats.black
        this.strength = stats.connectionStrength
        this.damp = stats.connectionDamp
        this.bound = { left: 0, right: 0, up: 0, down: 0 }
        this.lastBound = { left: 0, right: 0, up: 0, down: 0 }
        this.tempBound = { left: 0, right: 0, up: 0, down: 0 }
    }
    addBoundingBox() {
        let { bound, lastBound } = this
        transferBound(this.boundsAt(), bound)
        let { left, right, up, down } = bound
        let { left: left1, right: right1, up: up1, down: down1 } = lastBound
        if (left == left1 && right == right1 && up == up1 && down == down1) return
        this.removeBoundingBox()
        for (let i = left; i < right; i++) {
            for (let j = down; j < up; j++) {
                if (!boundingBoxes[j]) boundingBoxes[j] = {}
                if (!boundingBoxes[j][i]) boundingBoxes[j][i] = new Set()
                boundingBoxes[j][i].add(this)
            }
        }
        transferBound(bound, lastBound)
    }
    removeBoundingBox() {
        let { lastBound } = this
        let { left: left1, right: right1, up: up1, down: down1 } = lastBound
        for (let i = left1; i < right1; i++) {
            for (let j = down1; j < up1; j++) {
                if (!boundingBoxes[j]?.[i]) continue
                boundingBoxes[j][i].delete(this)
                let row = boundingBoxes[j]
                let cell = row?.[i]
                if (!cell) continue
                if (cell.size === 0) {
                    delete row[i]

                    let rowEmpty = true
                    for (let key in row) {
                        rowEmpty = false
                        break
                    }
                    if (rowEmpty) {
                        delete boundingBoxes[j]
                    }
                }
            }
        }
    }
    boundsAt() {
        let { a, b, tempBound: bound } = this
        let { x: x1, y: y1 } = a
        let { x: x2, y: y2 } = b
        bound.left = floor(min(x1, x2) / boundingBoxSize)
        bound.right = floor(max(x1, x2) / boundingBoxSize) + 1
        bound.down = floor(min(y1, y2) / boundingBoxSize)
        bound.up = floor(max(y1, y2) / boundingBoxSize) + 1
        return bound
    }
    other(ball) {
        if (this.a == ball) return this.b
        return this.a
    }
    remove() {
        let { a, b, ballConnection } = this
        for (let i = 0; i < a.connections.length; i++) {
            if (a.connections[i] == this) {
                a.connections.splice(i, 1)
            }
        }
        for (let i = 0; i < b.connections.length; i++) {
            if (b.connections[i] == this) {
                b.connections.splice(i, 1)
            }
        }
        for (let i = 0; i < connections.length; i++) {
            if (connections[i] == this) {
                connections.splice(i, 1)
            }
        }
        if (ballConnection) {
            ballConnection.x = (a.x + b.x) / 2
            ballConnection.y = (a.y + b.y) / 2
            balls.push(ballConnection)
        }
        this.removeBoundingBox()
    }
    exists() {
        return connections.includes(this)
    }
    draw() { // connection.draw
        let { a, b, type } = this
        save()
        scroll()
        lineWidth = 10
        let deathTimer = a.deathTimer || b.deathTimer
        if (deathTimer) {
            globalAlpha = 1 - (time - deathTimer) / 100
            lineWidth = 10 * (1 + (time - deathTimer) / 200)
        }
        if (type == 'black') {
            strokeStyle = '#333'
        }
        if (type == 'white') {
            strokeStyle = 'rgba(255,255,255,0.7)'
        }
        if (type == 'green') {
            strokeStyle = '#029f12'
        }
        if (type == 'steel') {
            strokeStyle = '#485b7a'
        }
        beginPath()
        moveTo(a.x, a.y)
        lineTo(b.x, b.y)
        stroke()
        restore()
    }
}
class Triangle {
    constructor(a, b, c) {
        this.a = a
        this.b = b
        this.c = c
    }
}
function connect(a, b, c) {
    let connection = new Connection(a, b, c)
    connections.push(connection)
    a.connections.push(connection)
    b.connections.push(connection)
    for (let c1 of a.connections) {
        let other = c1.other(a)
        for (let c2 of b.connections) {
            let other2 = c2.other(b)
            if (other == other2) {
                triangles.push(new Triangle(a, b, other))
            }
        }
    }
    return connection
}
class Surface {
    constructor(x1, y1, x2, y2, id = randint(0, 1e12)) {
        this.x1 = x1;
        this.y1 = y1;
        this.x2 = x2;
        this.y2 = y2;
        this.basex1 = x1;
        this.basey1 = y1;
        this.basex2 = x2;
        this.basey2 = y2;
        this.friction = 0.5
        this.sticky = 0
        if (id == 'sticky1') {
            this.sticky = 30
        }
        if (id == 'sticky2') {
            this.sticky = 90
        }
        this.id = id
        this.vx1 = 0;
        this.vy1 = 0;
        this.vx2 = 0;
        this.vy2 = 0;
        this.bound = { left: 0, right: 0, up: 0, down: 0 }
        this.lastBound = { left: 0, right: 0, up: 0, down: 0 }
        this.tempBound = { left: 0, right: 0, up: 0, down: 0 }
    }
    addBoundingBox() {
        let { bound, lastBound } = this

        transferBound(this.boundsAt(), bound)
        let { left, right, up, down } = bound
        let { left: left1, right: right1, up: up1, down: down1 } = lastBound
        if (left == left1 && right == right1 && up == up1 && down == down1) return
        for (let i = left1; i < right1; i++) {
            for (let j = down1; j < up1; j++) {
                if (!boundingBoxes[j]?.[i]) continue
                boundingBoxes[j][i].delete(this)
                let row = boundingBoxes[j]
                let cell = row?.[i]
                if (!cell) continue
                if (cell.size === 0) {
                    delete row[i]

                    let rowEmpty = true
                    for (let key in row) {
                        rowEmpty = false
                        break
                    }
                    if (rowEmpty) {
                        delete boundingBoxes[j]
                    }
                }
            }
        }
        for (let i = left; i < right; i++) {
            for (let j = down; j < up; j++) {
                if (!boundingBoxes[j]) boundingBoxes[j] = {}
                if (!boundingBoxes[j][i]) boundingBoxes[j][i] = new Set()
                boundingBoxes[j][i].add(this)
            }
        }
        transferBound(bound, lastBound)
    }
    boundsAt() {
        let { x1, y1, x2, y2, tempBound: bound } = this
        bound.left = floor(min(x1, x2) / boundingBoxSize)
        bound.right = floor(max(x1, x2) / boundingBoxSize) + 1
        bound.down = floor(min(y1, y2) / boundingBoxSize)
        bound.up = floor(max(y1, y2) / boundingBoxSize) + 1
        return bound
    }
    tick() { // surface.tick
        let { x1, y1, x2, y2, basex1, basey1, basex2, basey2, id } = this

        if (id == 'rotate') {
            let spinval = ticks / ticksPerSecond * 0.2
            x1 = basex1 * cos(spinval) - basey1 * sin(spinval)
            y1 = basex1 * sin(spinval) + basey1 * cos(spinval)
            x2 = basex2 * cos(spinval) - basey2 * sin(spinval)
            y2 = basex2 * sin(spinval) + basey2 * cos(spinval)
        }
        this.vx1 = (x1 - this.x1) / dt
        this.vy1 = (y1 - this.y1) / dt
        this.vx2 = (x2 - this.x2) / dt
        this.vy2 = (y2 - this.y2) / dt
        this.x1 = x1
        this.y1 = y1
        this.x2 = x2
        this.y2 = y2
    }
    draw() {
        const { x1, y1, x2, y2 } = this

        save()
        scroll()
        beginPath();
        moveTo(x1, y1);
        lineTo(x2, y2);
        lineWidth = 2
        lineCap = 'round'
        stroke()
        restore()
    }
}

let saws = []

class Saw {
    constructor(x, y, size, id = 'basic') {
        this.x = x
        this.y = y
        this.size = size
        this.id = id
        this.bound = { left: 0, right: 0, up: 0, down: 0 }
        this.lastBound = { left: 0, right: 0, up: 0, down: 0 }
        this.tempBound = { left: 0, right: 0, up: 0, down: 0 }
    }
    addBoundingBox() { // Ball.addBoundingBox
        const { x, y, size, bound, lastBound, connections } = this
        transferBound(this.boundsAt(x, y), bound)
        let { left, right, up, down } = bound
        let { left: left1, right: right1, up: up1, down: down1 } = lastBound
        if (left == left1 && right == right1 && up == up1 && down == down1 && mouse.draggedBall != this) return
        this.removeBoundingBox()
        if (mouse.draggedBall == this && !connections.length) {
            lastBound.left = left
            lastBound.right = left
            lastBound.up = down
            lastBound.down = down
            return
        }
        for (let i = left; i < right; i++) {
            for (let j = down; j < up; j++) {
                if (!boundingBoxes[j]) boundingBoxes[j] = {}
                if (!boundingBoxes[j][i]) boundingBoxes[j][i] = new Set()
                boundingBoxes[j][i].add(this)
            }
        }
        transferBound(bound, lastBound)
    }
    boundsAt(x, y) { // Ball.boundsAt
        let { tempBound: bound, size } = this
        bound.left = floor((x - size) / boundingBoxSize)
        bound.right = floor((x + size) / boundingBoxSize) + 1
        bound.up = floor((y + size) / boundingBoxSize) + 1
        bound.down = floor((y - size) / boundingBoxSize)
        return bound
    }
    removeBoundingBox() { // Ball.removeBoundingBox
        let { left: left1, right: right1, up: up1, down: down1 } = this.lastBound
        for (let i = left1; i < right1; i++) {
            for (let j = down1; j < up1; j++) {
                if (!boundingBoxes[j]?.[i]) continue
                boundingBoxes[j][i].delete(this)
                let row = boundingBoxes[j]
                let cell = row?.[i]
                if (!cell) continue
                if (cell.size === 0) {
                    delete row[i]

                    let rowEmpty = true
                    for (let key in row) {
                        rowEmpty = false
                        break
                    }
                    if (rowEmpty) {
                        delete boundingBoxes[j]
                    }
                }
            }
        }
    }
    tick() {

    }
    draw() {
        let { x, y, size, id } = this
        save()
        scroll()
        beginPath()
        translate(x, y)
        scale(size, size)
        rotate(-ticks / 500)
        arc(0, 0, 0.7, 0, 2 * pi)
        for (let i = 0; i < 2 * pi; i += pi / 15) {
            moveTo(0, 0)
            lineTo(cos(i), sin(i))
            lineTo(-sin(i) * 0.5, cos(i) * 0.5)
        }
        fillStyle = '#222'
        fill()
        restore()
    }
}
function saw(...args) {
    saws.push(new Saw(...args))
}


let walls = []
class Wall {
    constructor(path, id) {
        path.push(path[0])
        path.push(path[1])
        this.surfaces = []
        this.id = id
        for (let i = 0; i < path.length - 3; i += 2) {
            let s = new Surface(path[i], path[i + 1], path[i + 2], path[i + 3], id)
            this.surfaces.push(s)
            surfaces.push(s)
        }
    }
    draw() { // wall.draw
        let { surfaces, id } = this
        save()
        scroll()
        if (id == 'transparent') {
            beginPath()
            moveTo(surfaces[0].x1, surfaces[0].y1)
            for (let surface of surfaces) {
                lineTo(surface.x2, surface.y2)
            }
            closePath()
            lineWidth = 10
            strokeStyle = 'rgba(200,200,200,0.2)'
            stroke()
        } else {
            beginPath()
            moveTo(surfaces[0].x1, surfaces[0].y1)
            for (let surface of surfaces) {
                lineTo(surface.x2, surface.y2)
            }
            closePath()
            fillStyle = '#000'
            fill()
        }

        restore()
    }
}

class Pipe {
    constructor(type, ...path) {
        this.path = []
        for (let i = 0; i < path.length; i += 2) {
            this.path.push([path[i], path[i + 1]])
        }
        this.x = this.path[0][0]
        this.y = this.path[0][1]
        this.type = type
        this.active = false
        this.previousActive = false
        this.strength = 15
        this.range = 75
    }
    tick() { // Pipe.tick
        let { path, range, x, y } = this
        this.active = false
        if (gameState !== 'active') return
        for (let ball of balls) {
            if (ball.connections.length && norm(ball.x, ball.y, x, y) < sq(range)) {
                this.active = true
            }
        }
        if (this.previousActive && !this.active) {
            for (let ball of balls) {
                if (norm(ball.x, ball.y, x, y) < sq(range) && mouse.draggedBall != ball) {
                    ball.pipeSucked = true
                }
            }
        }
        this.previousActive = this.active
    }
    draw() { // Pipe.draw
        let { path, active } = this
        save()
        scroll()
        beginPath()
        moveTo(path[0][0], path[0][1])
        for (let i = 0; i < path.length - 1; i++) {
            let next = path[i + 1]
            lineTo(next[0], next[1])
        }
        lineWidth = 30
        strokeStyle = '#555'
        stroke()
        lineWidth = 37
        strokeStyle = '#333'
        for (let i = 0; i < path.length - 1; i++) {
            let cur = path[i]
            let next = path[i + 1]
            let dx = next[0] - cur[0]
            let dy = next[1] - cur[1]
            let nx = dx / dist(dx, dy)
            let ny = dy / dist(dx, dy)
            beginPath()
            let e = 34
            let b = lineWidth / 2
            if (i) {
                moveTo(cur[0] - nx * b, cur[1] - ny * b)
                lineTo(cur[0] + nx * e, cur[1] + ny * e)
            } else {
                save()
                translate(cur[0], cur[1])
                if (active) {
                    let s = 1.05 + 0.05 * sin(ticks / 100)
                    scale(s, s)
                }
                moveTo(ny * 25, 0)
                lineTo(-ny * 25, 0)
                lineTo(-ny * b, ny * 30)
                lineTo(ny * b, ny * 30)
                lineTo(ny * 25, 0)
                fillStyle = '#333'
                fill()
                beginPath()
                restore()
            }
            moveTo(next[0] + nx * b, next[1] + ny * b)
            lineTo(next[0] - nx * e, next[1] - ny * e)
            stroke()
        }
        stroke()
        restore()
    }
}

let pipe = null

function wall(id, ...path) {
    walls.push(new Wall(path, id))
}

let surfaces = []

class Mouse {
    constructor() {
        this.sx = 0
        this.sy = 0
        this.x = 0
        this.y = 0
        this[0] = false
        this[1] = false
        this[2] = false
        this.last = { x: 0, y: 0, 0: 0, 1: 0, 2: 0 }
        this.lastx = 0
        this.lasty = 0
        this.path = []
        this.closestBall = null
        this.draggedBall = null
        this.throwPath = []
    }
    findConnections() { // Mouse.findConnections
        let { draggedBall } = this
        if (!draggedBall || draggedBall.inTriangle()) return []
        let { x, y, maxConnectionLen, minConnections, maxConnections } = draggedBall
        let left = floor((x - maxConnectionLen) / boundingBoxSize)
        let right = floor((x + maxConnectionLen) / boundingBoxSize) + 1
        let down = floor((y - maxConnectionLen) / boundingBoxSize)
        let up = floor((y + maxConnectionLen) / boundingBoxSize) + 1
        seenId++
        let closestBalls = []
        for (let i = left; i < right; i++) {
            for (let j = down; j < up; j++) {
                let cell = boundingBoxes[j]?.[i]
                if (!cell) continue
                for (let ball of cell) {
                    if (ball.seen == seenId || !(ball instanceof Ball) || ball.connections.length == 0) continue
                    ball.seen = seenId
                    closestBalls.push(ball)
                }
            }
        }
        closestBalls = closestBalls.filter(b => norm(b.x, b.y, x, y) <= sq(maxConnectionLen)).sort((a, b) => norm(a.x, a.y, x, y) - norm(b.x, b.y, x, y))
        if (closestBalls.length >= 2) {
            for (let i = 0; i < closestBalls.length - 1; i++) {
                for (let j = i + 1; j < closestBalls.length; j++) {
                    let b1 = closestBalls[i]
                    let b2 = closestBalls[j]
                    if (abs(atan2(b1.y - draggedBall.y, b1.x - draggedBall.x) - atan2(draggedBall.y - b2.y, draggedBall.x - b2.x)) < pi / 4 && dist(b1.x, b1.y, b2.x, b2.y) < draggedBall.maxConnectionLen * 1.5 && !b1.connectedTo(b2)) {
                        let returnVal = [b1, b2]
                        returnVal.lineConnection = true
                        return returnVal
                    }
                }
            }
        }
        if (closestBalls.length < minConnections) return []
        return closestBalls.slice(0, maxConnections)

    }
    updateLast() {
        let { last, sx, sy } = this
        last.x = sx
        last.y = sy
        last[0] = this[0]
        last[1] = this[1]
        last[2] = this[2]
    }
    tick() { // Mouse.tick
        let { sx, sy, path, last, draggedBall, throwPath } = this
        this.x = screenToWorld(sx, sy).x
        this.y = screenToWorld(sx, sy).y
        let { x: x, y: y } = this

        for (let i = 0; i < 10; i++) {
            if (path.length > 1) path.shift()
        }
        if (path.length < 1) path.push([x, y])
        let [pathx, pathy] = path.at(-1)
        let d = _ => dist(pathx, pathy, x, y)
        let step = 2 / zoom
        while (d() > step) {
            pathx += (x - pathx) / d() * step
            pathy += (y - pathy) / d() * step
            path.push([pathx, pathy])
        }
        path.push([x, y])
        while (path.length > 100) path.shift()

        if (gameState != 'active') return

        throwPath.push({ x: x, y: y, t: time })
        while (time - throwPath[0].t > 100) {
            throwPath.shift()
        }

        let closest = 1e9
        let closestBall = null
        let grabRange = 100 / zoom
        let left = floor((x - grabRange) / boundingBoxSize)
        let right = floor((x + grabRange) / boundingBoxSize) + 1
        let down = floor((y - grabRange) / boundingBoxSize)
        let up = floor((y + grabRange) / boundingBoxSize) + 1
        seenId++
        for (let i = left; i < right; i++) {
            for (let j = down; j < up; j++) {
                let cell = boundingBoxes[j]?.[i]
                if (!cell) continue
                for (let ball of cell) {
                    if (ball.seen == seenId || !(ball instanceof Ball) || !ball.detachable && ball.connections.length || !ball.awake) continue
                    ball.seen = seenId
                    let d = norm(x, y, ball.x, ball.y)
                    if (d < min(closest, sq(grabRange))) {
                        closest = d
                        closestBall = ball
                    }
                }
            }
        }
        if (draggedBall && draggedBall.connections.length && norm(draggedBall.x, draggedBall.y, x, y) > sq(50 / zoom)) {
            while (draggedBall.connections.length) {
                draggedBall.connections[0].remove()
            }
            levelStats.moves++
        }
        if (mouse[0] && !mouse.last[0] && !draggedBall) {
            this.draggedBall = closestBall
            if (this.draggedBall) {
                this.draggedBall.structureMove.active = false
            }

        } else if (!mouse[0] && draggedBall) {
            if (!draggedBall.connections.length) {
                closestBall = draggedBall
                let connections = this.findConnections()
                if (throwPath.length && !draggedBall.connections.length) {
                    let first = throwPath[0]
                    let last = throwPath.at(-1)
                    let dt = max(1e-6, (last.t - first.t) / 1000)
                    let vx = (last.x - first.x) / dt
                    let vy = (last.y - first.y) / dt
                    let maxThrowSpeed = 50
                    let power = 0.01
                    draggedBall.vx = clamp(vx * power, -maxThrowSpeed, maxThrowSpeed)
                    draggedBall.vy = clamp(vy * power, -maxThrowSpeed, maxThrowSpeed)
                }
                if (norm(draggedBall.vx, draggedBall.vy) < 50) {
                    draggedBall.vx = 0
                    draggedBall.vy = 0
                    if (connections.length) levelStats.moves++
                    if (connections.lineConnection) {
                        connect(connections[0], connections[1], draggedBall)
                        draggedBall.remove()
                    } else {
                        for (let connection of connections) {
                            connect(draggedBall, connection)
                        }
                    }
                }
            }
            this.draggedBall = null
        }

        this.closestBall = closestBall

    }
    draw() { // mouse.draw
        const { closestBall, path, draggedBall } = this

        save()
        scroll()
        if (closestBall && !mouse[0] || draggedBall) {
            const { x, y } = draggedBall || closestBall
            let angle = time / 1000
            translate(x, y)
            fillStyle = '#000'
            strokeStyle = '#fff'
            lineCap = 'round'
            lineWidth = 2;
            for (let j = 0; j < (draggedBall && !draggedBall.connections.length ? 2 : 1); j++) {
                rotate(angle)
                beginPath()
                let orbitRadius = 20
                let base = 25
                let height = 30
                for (let i = 0; i < 4; i++) {
                    rotate(pi / 2)
                    moveTo(orbitRadius, 0)
                    lineTo(orbitRadius + height, base / 2)
                    lineTo(orbitRadius + height, -base / 2)
                    lineTo(orbitRadius, 0)
                }
                fill()
                stroke()
                scroll()
                translate(mouse.x, mouse.y)
                if (norm(mouse.x, mouse.y, x, y) < 1) break
                fillStyle = 'rgba(0,0,0,0.4)'
                strokeStyle = '#BBB'
            }
        } else {
            let w = 5
            lineWidth = w
            lineCap = 'round'
            strokeStyle = '#fff'
            for (let i = 1; i < path.length; i++) {
                w += 15 / (path.length - 1)
                lineWidth = w
                beginPath()
                moveTo(path[i - 1][0], path[i - 1][1])
                lineTo(path[i][0], path[i][1])
                stroke()
            }
            w = 3
            lineWidth = w
            lineCap = 'round'
            strokeStyle = '#000'
            for (let i = 1; i < path.length; i++) {
                w += 15 / (path.length - 1)
                lineWidth = w
                beginPath()
                moveTo(path[i - 1][0], path[i - 1][1])
                lineTo(path[i][0], path[i][1])
                stroke()
            }
        }
        restore()
    }
    drawConnections() {
        let { draggedBall } = this
        if (!draggedBall || draggedBall.connections.length) return
        let { x, y, maxConnectionLen } = draggedBall
        let connections = this.findConnections()
        save()
        scroll()
        beginPath()
        let thickness = 10
        if (connections.lineConnection) {
            let { x: x1, y: y1 } = connections[0]
            let { x: x2, y: y2 } = connections[1]
            moveTo(x1, y1)
            lineTo(x2, y2)
            thickness = min(thickness, 50 * (1 - dist(x1, y1, x2, y2) / maxConnectionLen / 1.5))
        } else {
            for (let connection of connections) {
                moveTo(x, y)
                lineTo(connection.x, connection.y)
                thickness = min(thickness, 50 * (1 - dist(x, y, connection.x, connection.y) / maxConnectionLen))
            }
        }
        lineWidth = thickness + 1
        strokeStyle = '#fff'
        globalAlpha = thickness / 20 + 0.1
        stroke()
        restore()
    }
}
let mouse = new Mouse()

let buttonInfo = {
    continue: { x: canvas.width - 325, y: -100, width: 300, height: 75 },
    ballsTarget: { x: 1150, y: 0, width: 40, height: 40 },
    movesTarget: { x: 1150, y: 0, width: 40, height: 40 },
    timeTarget: { x: 1150, y: 0, width: 40, height: 40 },
    restart: { x: canvas.width - 115, y: -100, width: 100, height: 100 },
    menu: { x: 15, y: 15, width: 75, height: 75 }
}
class Button {
    constructor(id) {
        this.id = id
        let info = buttonInfo[id]
        this.x = info?.x || 0
        this.y = info?.y || 0
        this.width = info?.width || 100
        this.height = info?.height || 100
        this.hovered = false
        this.mouseDown = false
    }
    tick() { // button.tick
        let { id, x, y, width, height } = this
        if (mouse.sx > x && mouse.sx < x + width && mouse.sy > y && mouse.sy < y + height) {
            this.hovered = true
            if (mouse[0] && !mouse.last[0]) {
                this.mouseDown = true
            }
            if (!mouse[0] && mouse.last[0] && this.mouseDown) {
                this.onclick()
            }
        } else {
            this.hovered = false
        }
        if (!mouse[0]) {
            this.mouseDown = false
        }

        if (id == 'continue') {
            let targety = -height - 25
            if (levelStats.collectedBalls >= levelStats.minBalls && gameState == 'active') {
                if (!levelStats.completionTime) levelStats.completionTime = time
                targety = 25
            }
            this.x = canvas.width - width - 25
            this.y += (targety - y) / 5
            if (abs(this.y - targety) < 3) this.y = targety
            this.targetexpand = this.hovered ? 1.1 : 1
        }
        if (id.includes('Target')) {
            this.targetAlpha = this.hovered ? 1 : 0
            let challenges = levelChallenges[level] || {}
            if (id == 'ballsTarget') this.completed = levelStats.targetBalls && challenges.balls >= levelStats.targetBalls
            if (id == 'movesTarget') this.completed = levelStats.targetMoves && challenges.moves <= levelStats.targetMoves
            if (id == 'timeTarget') this.completed = levelStats.targetTime && challenges.time < (levelStats.targetTime + 1) * 1000
        }
        if (id == 'restart') {
            let targety = this.shown ? 25 : -height - 25
            this.x = canvas.width - width - 25
            this.y += (targety - y) / 8
            if (abs(this.y - targety) < 3) this.y = targety
            this.targetcolor = this.hovered ? 1 : 0
            this.color = this.color || 0
            this.color += (this.targetcolor - this.color) / 5
        }
        if (id == 'menu') {
            if (!this.buttons) this.buttons = {
                retry: new Button('retry'),
                distinctions: new Button('distinctions'),
                back: new Button('back'),
            }
            if (!this.heightDisplay) this.heightDisplay = height
            let targetHeight = this.expand ? height * 4 : height
            this.heightDisplay += (targetHeight - this.heightDisplay) / 5
            if (abs(this.heightDisplay - targetHeight) < 1) this.heightDisplay = targetHeight
            for (let i = 0, ids = ['retry', 'distinctions', 'back']; i < ids.length; i++) {
                let button = this.buttons[ids[i]]
                button.x = x
                button.y = y + height * (i + 1)
                button.width = width
                button.height = height
                if (this.heightDisplay >= height * (i + 2)) {
                    button.tick()
                } else {
                    button.hovered = false
                    button.mouseDown = false
                }
            }
        }
    }
    onclick() { // button.onclick
        let { id } = this
        if (id == 'continue') {
            gameState = 'completed'
            completeScreen = new CompleteScreen()
            let completionTime = levelStats.completionTime - levelStats.startTime
            let challenges = levelChallenges[level] || {}
            challenges.balls = max(challenges.balls || 0, levelStats.collectedBalls)
            challenges.moves = challenges.moves == null ? levelStats.moves : min(challenges.moves, levelStats.moves)
            challenges.time = challenges.time == null ? completionTime : min(challenges.time, completionTime)
            levelChallenges[level] = challenges
            localStorage.levelChallenges = JSON.stringify(levelChallenges)
        }
        if (id == 'restart') {
            setupLevel(level)
        }
        if (id == 'retry') {
            menuBtn.expand = false
            setupLevel(level)
        }
        if (id == 'distinctions') {
            menuBtn.expand = false
            gameState = 'distinctions'
        }
        if (id == 'menu') {
            if (gameState != 'active') return
            this.expand = !this.expand
        }
    }
    draw() { // button.draw
        let { id, x, y, width, height, targetexpand } = this
        save()
        if (['retry', 'distinctions', 'back'].includes(id)) {
            if (this.hovered) {
                fillStyle = '#333'
                fillRect(x, y, width, height)
            }
            strokeStyle = '#eee'
            fillStyle = '#eee'
            lineCap = 'round'
            lineJoin = 'round'
            if (id == 'retry') {
                let drawTip = p => {
                    beginPath()
                    moveTo(p[0], p[1])
                    lineTo(p[2], p[3])
                    lineTo(p[4], p[5])
                    closePath()
                    fill()
                }
                translate(x, y)
                scale(width / 100, height / 100)
                beginPath()
                arc(50, 50, 28, 0.85 * pi, -0.85 * pi, true)
                lineWidth = 9
                stroke()
                drawTip([14.8, 46.8, 15.5, 27, 34.6, 47.5])
            }
            if (id == 'distinctions') {
                translate(x + width / 2, y + height / 2)
                rotate(-pi / 10)
                lineWidth = 5
                beginPath()
                moveTo(-12, 25)
                lineTo(-12, -25)
                stroke()
                beginPath()
                moveTo(-12, -25)
                lineTo(25, -15)
                lineTo(-12, -5)
                closePath()
                fill()
            }
            if (id == 'back') {
                beginPath()
                moveTo(x + width * 0.25, y + height * 0.5)
                lineTo(x + width * 0.55, y + height * 0.25)
                lineTo(x + width * 0.55, y + height * 0.4)
                lineTo(x + width * 0.78, y + height * 0.4)
                lineTo(x + width * 0.78, y + height * 0.6)
                lineTo(x + width * 0.55, y + height * 0.6)
                lineTo(x + width * 0.55, y + height * 0.75)
                closePath()
                fill()
            }
        }
        if (id == 'continue') {
            beginPath()
            let radius = 20
            this.expand = this.expand || 0
            this.expand += (targetexpand - this.expand) / 5
            let e = this.expand
            roundRect(x + (1 - e) * width / 2, y + (1 - e) * height / 2, width * e, height * e, radius * e)
            fillStyle = '#06b500'
            fill()
            strokeStyle = '#058f00'
            lineWidth = 5
            stroke()
            textAlign = 'center'
            textBaseline = 'middle'
            text('Continue', x + width / 2, y + height / 2, height * 0.6 * e)
        }
        if (id.includes('Target')) {
            let radius = 10
            beginPath()
            roundRect(x, y, width, height, radius)
            strokeStyle = '#000'
            lineWidth = 10
            stroke()
            beginPath()
            roundRect(x, y, width, height, radius)
            strokeStyle = '#fff'
            lineWidth = 5
            stroke()
            if (this.completed) {
                let poleGradient = createLinearGradient(x + 20, y + height - 6, x + 26, y - 28)
                poleGradient.addColorStop(0, 'rgba(70,45,20,0)')
                poleGradient.addColorStop(0.3, 'rgba(70,45,20,0.65)')
                poleGradient.addColorStop(1, 'rgba(70,45,20,1)')

                beginPath()
                moveTo(x + 20, y + height - 6)
                lineTo(x + 26, y - 28)
                strokeStyle = poleGradient
                lineWidth = 5
                lineCap = 'round'
                stroke()

                let flagGradient = createLinearGradient(x + 26, y - 28, x + 65, y - 13)
                flagGradient.addColorStop(0, '#8b0000')
                flagGradient.addColorStop(1, '#e22')

                beginPath()
                moveTo(x + 26, y - 28)
                lineTo(x + 65, y - 13)
                lineTo(x + 23.5, y - 2)
                closePath()
                fillStyle = flagGradient
                fill()
            }
            this.alpha = this.alpha || 0
            this.alpha += (this.targetAlpha - this.alpha) / 5
            globalAlpha = this.alpha
            fillStyle = 'rgba(100,100,100,0.5)'
            fillRect(x + 80, y - 39, 300, 100)
            if (id == 'ballsTarget') {
                text('The amout of balls you collected', x + 90, y - 20, 16)
                text('Challenge: ' + levelStats.targetBalls + " balls or more", x + 90, y + 30, 16)
                text('Best: ' + levelChallenges[level].balls + " balls", x + 90, y + 50, 16)
            } else if (id == 'movesTarget') {
                text('The amout of moves you used to', x + 90, y - 20, 16)
                text('complete the level', x + 90, y, 16)
                text('Challenge: ' + levelStats.targetMoves + " moves or less", x + 90, y + 30, 16)
                text('Best: ' + levelChallenges[level].moves + " moves", x + 90, y + 50, 16)
            } else if (id == 'timeTarget') {
                text('The amout of time you used to', x + 90, y - 20, 16)
                text('complete the level', x + 90, y, 16)
                text('Challenge: ' + levelStats.targetTime + " seconds or less", x + 90, y + 30, 16)
                text('Best: ' + floor(levelChallenges[level].time / 1000) + " seconds", x + 90, y + 50, 16)
            }

        }
        if (id == 'restart') {
            let arrowColor = `rgb(${round(226 * (this.color || 0))},${round(34 * (this.color || 0))},${round(34 * (this.color || 0))})`
            let drawTip = (color, p) => {
                beginPath()
                moveTo(x + p[0], y + p[1])
                lineTo(x + p[2], y + p[3])
                lineTo(x + p[4], y + p[5])
                closePath()
                fillStyle = color
                fill()
            }
            lineCap = 'round'
            lineJoin = 'round'
            beginPath()
            arc(x + 50, y + 50, 28, 0.85 * pi, -0.85 * pi, true)
            strokeStyle = '#000'
            lineWidth = 16
            stroke()
            drawTip('#000', [11.9, 49.6, 12.9, 21.3, 40.1, 50.6])
            beginPath()
            arc(x + 50, y + 50, 28, 0.85 * pi, -0.85 * pi, true)
            strokeStyle = arrowColor
            lineWidth = 9
            stroke()
            drawTip(arrowColor, [14.8, 46.8, 15.5, 27, 34.6, 47.5])
        }
        if (id == 'menu') {
            if (!this.heightDisplay) this.heightDisplay = height
            beginPath()
            fillStyle = '#000'
            strokeStyle = '#555'
            lineWidth = 10
            roundRect(x, y, width, this.heightDisplay, 10)
            stroke()
            fill()
            save()
            beginPath()
            roundRect(x, y, width, this.heightDisplay, 10)
            clip()
            if (this.buttons) {
                for (let i = 0, ids = ['retry', 'distinctions', 'back']; i < ids.length; i++) {
                    if (this.heightDisplay > height * (i + 1) + 5) this.buttons[ids[i]].draw()
                }
            }
            beginPath()
            strokeStyle = '#555'
            lineWidth = 10
            moveTo(x + width / 6, y + width / 4)
            lineTo(x + width * 5 / 6, y + width / 4)
            moveTo(x + width / 6, y + width / 2)
            lineTo(x + width * 5 / 6, y + width / 2)
            moveTo(x + width / 6, y + width * 3 / 4)
            lineTo(x + width * 5 / 6, y + width * 3 / 4)
            stroke()
            restore()
            if (this.expand) {
                let labelsLeft = x > 150
                textAlign = labelsLeft ? 'right' : 'left'
                textBaseline = 'middle'
                for (let i = 0, labels = ['Retry', 'Challenges', 'Back']; i < labels.length; i++) {
                    if (this.heightDisplay > height * (i + 1) + 5) text(labels[i], labelsLeft ? x - 15 : x + width + 15, y + height * (i + 1.5), 30)
                }
            }
        }
        restore()
    }
}
let continueBtn = new Button('continue')
let menuBtn = new Button('menu')

class CompleteScreen {
    constructor() {
        this.start = time
        this.texts = { balls: canvas.height + 200, moves: canvas.height + 200, time: canvas.height + 200 }
        this.targetButtons = {
            balls: new Button('ballsTarget'),
            moves: new Button('movesTarget'),
            time: new Button('timeTarget')
        }
        this.restartButton = new Button('restart')
        this.updateTargetButtons()
    }
    updateTargetButtons() {
        let { texts, targetButtons } = this
        targetButtons.balls.y = texts.balls - targetButtons.balls.height + 4
        targetButtons.moves.y = texts.moves - targetButtons.moves.height + 4
        targetButtons.time.y = texts.time - targetButtons.time.height + 4
    }
    tick() {
        let { start, texts } = this
        let levelWidth = scrollLimits.right - scrollLimits.left
        let levelHeight = scrollLimits.up - scrollLimits.down
        let targetZoom = max(canvas.width / levelWidth, canvas.height / levelHeight)
        let o = screenToWorld(canvas.width / 2, canvas.height / 2)
        let finalScroll = clampedScrollAtZoom(
            o.x + canvas.width / 2 - canvas.width / (2 * targetZoom),
            o.y - canvas.height / 2 + canvas.height / (2 * targetZoom),
            targetZoom
        )
        let targetCenter = {
            x: finalScroll.x - canvas.width / 2 + canvas.width / (2 * targetZoom),
            y: finalScroll.y + canvas.height / 2 - canvas.height / (2 * targetZoom)
        }
        zoom += (targetZoom - zoom) / 30
        let n = screenToWorld(canvas.width / 2, canvas.height / 2)
        scrollx -= n.x - o.x
        scrolly -= n.y - o.y
        let targetScroll = {
            x: targetCenter.x + canvas.width / 2 - canvas.width / (2 * zoom),
            y: targetCenter.y - canvas.height / 2 + canvas.height / (2 * zoom)
        }
        scrollx += (targetScroll.x - scrollx) / 30
        scrolly += (targetScroll.y - scrolly) / 30
        clampScroll()
        updateScreen()
        let elapsed = time - start
        if (elapsed > 1000) {
            texts.balls += (300 - texts.balls) / 10
        }
        if (elapsed > 1600) {
            texts.moves += (400 - texts.moves) / 10
        }
        if (elapsed > 2200) {
            texts.time += (500 - texts.time) / 10
        }
        this.targetButtons.balls.x = canvas.width / 2 + 300
        this.targetButtons.moves.x = canvas.width / 2 + 300
        this.targetButtons.time.x = canvas.width / 2 + 300
        this.restartButton.shown = elapsed > 2800
        this.restartButton.tick()
        this.updateTargetButtons()
        for (let button of Object.values(this.targetButtons)) {
            button.tick()
        }

    }
    draw() {
        let { start, texts } = this
        save()
        beginPath()
        fillStyle = `rgba(100,100,100,${min(0.4, (time - start) / 1000)})`
        fillRect(0, 0, canvas.width, canvas.height)
        let offset = canvas.width / 2
        textAlign = 'left'
        text("Balls: " + levelStats.collectedBalls, offset, texts.balls, 50)
        text("Moves: " + levelStats.moves, offset, texts.moves, 50)
        text("Time: " + formatTime(levelStats.completionTime - levelStats.startTime), offset, texts.time, 50)
        for (let button of Object.values(this.targetButtons)) {
            button.draw()
        }
        this.restartButton.draw()
        restore()
    }
}

class FloatText {
    constructor(t, x, y, size, type) {
        this.t = t
        this.x = x
        this.y = y
        this.size = size
        if (type == 1) this.endLife = time + 1000
        if (type == 2) this.endLife = time + 2000
        if (type == 3) this.endLife = time + 2000
        this.type = type
    }
    tick() {
        let { t, x, y, size, endLife, type } = this
        if (type == 1) {
            this.y += 1
        }
        if (type == 3) {
            if (this.t == 'OCD!') pipeText = this
            if (pipeText != this && !this.watch) this.watch = pipeText
            if (this.watch && endLife > time + 300 && this.watch.endLife < time + 1500) {
                this.endLife = time + 300
            }
        }
        if (time > endLife) {
            for (let i = 0; i < floatingTexts.length; i++) {
                if (this == floatingTexts[i]) {
                    floatingTexts.splice(i, 1)
                    return true
                }
            }
        }
    }
    draw() {
        let { t, x, y, size, endLife, type } = this
        save()
        scroll()
        beginPath()
        scale(1, -1)
        if (type == 1) {
            globalAlpha = (endLife - time) / 1000
            text(t, x, -y, size)
        }
        if (type == 2) {
            globalAlpha = (endLife - time) / 300
            translate(x, -y)
            let rotateSpeed = 200
            rotate((max(endLife - time - 2000 + rotateSpeed, 0) - 300) / 300 * 2 + 2)
            text(t, 0, 0, -(max(endLife - time - 2000 + rotateSpeed, 0) - rotateSpeed) / rotateSpeed * size)
        }
        if (type == 3) {
            let p = endLife - time
            if (p > 0) {
                let i = min(1, (2000 - p) / 500)
                let angle = pi / 6 + 2 * pi * i
                let radius = 2 * (p < 300 ? p / 300 * 40 : i * 40)
                translate(x + radius * cos(angle), -y - radius * sin(angle))
                rotate(2 * (1 - i))
                text(t, 0, 0, radius / 2 * size / 40)
            }
        }
        restore()
    }
}

let pipeText = null

let floatingTexts = []
function floatingText(...args) {
    let a = new FloatText(...args)
    floatingTexts.push(a)
    return a
}

class DistinctionPage {
    constructor() {
        this.balls = new Button('ballsTarget')
        this.moves = new Button('movesTarget')
        this.time = new Button('timeTarget')
    }
    tick() {
        let { balls, moves, time } = this
        balls.x = 300
        moves.x = 300
        time.x = 300
        balls.y = 300
        moves.y = 500
        time.y = 700
        balls.tick()
        moves.tick()
        time.tick()
        if (mouse[0]) gameState = 'active'
    }
    draw() {
        let { balls, moves, time } = this
        fillStyle = '#111'
        fillRect(0, 0, canvas.width, canvas.height);
        textAlign = 'center'
        text('Optional Completion Distinctions', canvas.width / 2, 150, 80)
        textAlign = 'left'
        text('Balls:', balls.x + 100, balls.y + 40, 50)
        text('Moves:', moves.x + 100, moves.y + 40, 50)
        text('Time:', time.x + 100, time.y + 40, 50)
        balls.draw()
        moves.draw()
        time.draw()
        textAlign = 'right'
        text('collect ' + levelStats.targetBalls + ' or more balls', 1400, balls.y + 40, 50)
        text('complete in ' + levelStats.targetMoves + ' or fewer moves', 1400, moves.y + 40, 50)
        text('finish in ' + formatTime(levelStats.targetTime * 1000) + ' or less', 1400, time.y + 40, 50)
        text('your best: ' + levelChallenges[level].balls + ' balls', 1400, balls.y + 70, 20)
        text('your best: ' + levelChallenges[level].moves + ' moves', 1400, moves.y + 70, 20)
        text('your best: ' + formatTime(levelChallenges[level].time), 1400, time.y + 70, 20)

    }
}

let distinctionPage = null

let completeScreen = null

let gameState = 'menu'

let levelInfo = {
    1: [4, 12, 3, 3],
    2: [5, 14, 18, 33],
    3: [25, 52, 10, 24],
    4: [20, 49, 15, 33],
    5: [8, 29, 15, 33],
    6: [24, 53, 2, 24],
    7: [44, 72, 48, 72],
    8: [0, 0, 0, 0],
    9: [0, 0, 0, 0],
    10: [0, 0, 0, 0],
    11: [0, 0, 0, 0],
    12: [0, 0, 0, 0],
    13: [0, 0, 0, 0],
    14: [0, 0, 0, 0],
}
let levelChallenges = (_ => {
    try {
        return JSON.parse(localStorage.levelChallenges || '{}')
    } catch {
        return {}
    }
})()


function setupLevel(level) {
    boundingBoxes = {}
    balls = []
    connections = []
    triangles = []
    walls = []
    surfaces = []
    saws = []
    pipe = null
    pipeText = null
    floatingTexts = []
    seenId = 0
    isScene = false
    sceneCovers.height = 0
    completeScreen = null
    distinctionPage = new DistinctionPage()
    ticks = 0
    ticksThisSecond = 0
    simulationSpeed = 0
    nextFrame = time
    mouse = new Mouse()
    continueBtn = new Button('continue')
    menuBtn = new Button('menu')
    gameState = 'active'
    let stats = levelInfo[level] ?? [0, 0, 0, 0]
    levelStats = {
        collectedBalls: 0,
        moves: 0,
        startTime: time,
        minBalls: stats[0],
        targetBalls: stats[1],
        targetMoves: stats[2],
        targetTime: stats[3],
    }
    if (level == 1) {
        createSquare(0, 20)
        wall('sticky1', -700, -500, -700, -300, -500, -150, -300, -50, -100, 0, 200, 0, 400, -50, 500, -100, 600, -150, 700, -150, 800, -100, 900, -75, 1000, -50, 1000, -500)
        surfaces.push(new Surface(-700, -500, -700, 1000, 'transparent'))
        surfaces.push(new Surface(1000, -500, 1000, 1000, 'transparent'))
        for (let i = 0; i < 10; i++) {
            ball(randfloat(0, 100), randfloat(20, 120), 'black')
        }
        for (let i = 0; i < 2; i++) {
            ball(randfloat(-600, 0), randfloat(500, 900), 'black')
        }
        for (let i = 0; i < 3; i++) {
            ball(randfloat(100, 900), randfloat(500, 900), 'black')
        }
        pipe = new Pipe('basic', 50, 400, 50, 600, -75, 600, -75, 750, 100, 750, 100, 1200)
        scrollLimits = {
            zoomMin: 2,
            zoomMax: 3,
            left: -700,
            right: 1000,
            up: 900,
            down: -400
        }
    }
    if (level == 2) {
        createSquare(50, 20)
        wall('basic', -500, 0, 200, 0, 250, -25, 275, -50, 275, -75, 0, -1000, -500, -1000)
        surfaces[0].sticky = 90
        wall('sticky2', 700, -300, 1500, -300, 1500, -1000)
        surfaces.push(new Surface(-500, -1000, -500, 2000, 'transparent'))
        surfaces.push(new Surface(1500, -1000, 1500, 2000, 'transparent'))
        for (let i = 0; i < 15; i++) {
            ball(randfloat(50, 150), randfloat(20, 120), 'black')
        }
        for (let i = 0; i < 5; i++) {
            ball(randfloat(-450, 0), randfloat(50, 100), 'black')
        }
        for (let i = 0; i < 12; i++) {
            ball(800 + 40 * i, -280, 'black', false)
        }
        pipe = new Pipe('basic', 1200, 100, 1200, 400, 1350, 400, 1350, 2000)
        scrollLimits = {
            zoomMin: 1,
            zoomMax: 2,
            left: -500,
            right: 1500,
            up: 700,
            down: -700
        }
    }
    if (level == 3) {
        wall('sticky2', -100, 0, -250, 0, -250, -50, -100, -50)
        wall('sticky2', 100, 0, 250, 0, 250, -50, 100, -50)
        wall('basic', -700, -400, -250, -500, -100, -600, 100, -600, 250, -500, 700, -400, 700, -1000, -700, -1000)
        surfaces.push(new Surface(-700, -1000, -700, 2000, 'transparent'))
        surfaces.push(new Surface(700, -1000, 700, 2000, 'transparent'))
        let a = ball(-120, 20, 'white')
        let b = ball(-50, -55, 'white')
        let c = ball(50, -55, 'white')
        let d = ball(120, 20, 'white')
        let c1 = connect(a, b)
        let c2 = connect(b, c)
        let c3 = connect(c, d)
        for (let i = 0; i < 12; i++) {
            let q = ball(0, 0, 'white')
            q.structureMove.active = true
            let choice = [c1, c2, c3][randint(0, 3)]
            q.structureMove.currentConnection = choice
            q.structureMove.previousNode = random() > 0.5 ? choice.a : choice.b
            q.structureMove.t = random()
        }
        for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 5; j++) {
                ball(-100 + 30 * i, -400 - j * 30, 'white', false)
            }
        }
        pipe = new Pipe('basic', 0, 400, 0, 1000)
        scrollLimits = {
            zoomMin: 1.5,
            zoomMax: 2,
            left: -700,
            right: 700,
            up: 600,
            down: -700
        }
    }
    if (level == 4) {
        createSquare(20, 20)
        wall('sticky2', 0, 0, 400, 0, 500, -50, 600, 0, 675, 100, 600, 200, -150, 300, -175, 350, -150, 400, 1000, 400, 1000, -500, 0, -200)
        saw(-125, 320, 75)
        for (let i = 0; i < 20; i++) {
            ball(randint(20, 120), randint(20, 120))
        }
        for (let [x, y] of [[225, 15], [581, 8], [499, -32], [525, 10], [257, 15], [403, 39], [472, -18], [497, 26], [470, 11], [352, 15], [442, 26], [484, 85], [415, 9], [444, -4], [498, -3], [553, -5], [383, 15], [289, 15], [320, 15], [526, -19], [429, 55], [470, 42], [552, 24], [336, 43], [607, 36], [578, 39], [626, 61], [525, 41], [457, 70], [497, 57], [552, 56], [525, 72], [595, 65], [568, 82]]) {
            ball(x, y + 1)
        }
        for (let i = -100; i < 400; i += 40) {
            ball(i, 416, 'black', false)
        }
        pipe = new Pipe('basic', 300, 600, 300, 1000)
        scrollLimits = {
            zoomMin: 1.5,
            zoomMax: 2,
            left: -700,
            right: 800,
            up: 800,
            down: -300
        }
    }
    if (level == 5) {
        let c = ball(0, 0, 'pin')
        let r = 200
        let p = null
        for (let i = 0; i < 2 * pi; i += pi / 5) {
            let a = ball(r * cos(i), r * sin(i), 'steel')
            connect(a, c)
            if (p) connect(a, p)
            p = a
        }
        connect(balls[1], p)
        for (let i = 0; i < 30; i++) {
            let q = ball(0, 0, 'green')
            q.structureMove.active = true
            let choice = randchoice(connections)
            q.structureMove.currentConnection = choice
            q.structureMove.previousNode = random() > 0.5 ? choice.a : choice.b
            q.structureMove.t = random()
        }
        pipe = new Pipe('basic', 0, 700, 0, 2000)
        scrollLimits = {
            zoomMin: 1.5,
            zoomMax: 2,
            left: -1000,
            right: 1000,
            up: 1000,
            down: -800
        }
    }
    if (level == 6) {
        let s = []
        for (let i = 0; i <= pi / 4 * 8; i += pi / 4) {
            s.push(600 * cos(i), 600 * sin(i))
        }
        for (let i = pi / 4 * 8; i >= 0; i -= pi / 4) {
            s.push(1000 * cos(i), 1000 * sin(i))
        }
        wall('rotate', ...s)
        createSquare(0, -200, 'green')
        for (let i = 0; i < 50; i++) {
            ball(randint(-200, 200), randint(-200, 200), 'green')
        }
        pipe = new Pipe('basic', 0, 0, 0, 200, 1000, 200)
        scrollLimits = {
            zoomMin: 1.5,
            zoomMax: 2,
            left: -650,
            right: 650,
            up: 650,
            down: -650
        }
    }
    if (level == 7) {
        createSquare(-50, 20, 'white')
        wall('sticky2', -1000, 0, 1000, 0, 1000, -500, -1000, -500)
        surfaces.push(new Surface(-1000, 0, -1000, 3000, 'transparent'))
        surfaces.push(new Surface(1000, 0, 1000, 3000, 'transparent'))
        pipe = new Pipe('basic', 0, 1800, 0, 3000)
        for (let i = 0; i < 120; i++) {
            ball(randint(-600, 600), randint(20, 2200), 'white')
        }
        scrollLimits = {
            zoomMin: 1,
            zoomMax: 2,
            left: -1000,
            right: 1000,
            up: 2200,
            down: -500
        }
    }
    clampScroll()
    updateScreen()
}

let level = 7

resize()
setupLevel(level)
document.body.style.cursor = 'none'
addEventListener('resize', resize)
addEventListener('mousemove', e => {
    mouse.sx = e.clientX
    mouse.sy = e.clientY
})
addEventListener('mousedown', e => {
    e.preventDefault()
    mouse[e.button] = true
})
addEventListener('mouseup', e => {
    e.preventDefault()
    mouse[e.button] = false
})
addEventListener('contextmenu', e => {
    e.preventDefault();
})
addEventListener('keydown', e => {
    e.key == '`' && createSquare(mouse.x, mouse.y)
    if (!Object.keys(ballStats)[parseInt(e.key) - 1]) return
    ball(mouse.x, mouse.y, Object.keys(ballStats)[parseInt(e.key) - 1])
})
document.addEventListener('wheel', e => {
    if (gameState != 'active') return
    let o = screenToWorld(mouse.sx, mouse.sy)
    if (e.deltaY > 0) {
        zoom /= 1.2
    }
    if (e.deltaY < 0) {
        zoom *= 1.2
    }
    zoom = clamp(zoom, scrollLimits.zoomMin, scrollLimits.zoomMax)
    let n = screenToWorld(mouse.sx, mouse.sy)
    scrollx -= n.x - o.x
    scrolly -= n.y - o.y
    clampScroll()
    updateScreen()
})
