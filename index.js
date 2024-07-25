const alias = {
    userId: 'properties.alias',
    previousId: ['properties.distinct_id'],
}

const page = {
    name: 'properties.name',
    'properties.category': 'properties.category',
    'properties.host': 'properties.$host',
    'properties.url': 'properties.$current_url',
    'properties.path': 'properties.$pathname',
    'properties.referrer': 'properties.$referrer',
    'properties.initial_referrer': 'properties.$initial_referrer',
    'properties.referring_domain': 'properties.$referring_domain',
    'properties.initial_referring_domain': 'properties.$initial_referring_domain',
}

const identify = {
    'context.traits': '$set',
    traits: '$set',
}

const group = {
    groupId: 'groupId',
    traits: 'traits',
}

const track = {
    event: 'event',
}

const constants = {
    'context.app.name': 'PostHogPlugin',
    channel: 's2s',
}

const generic = {
    'context.os.name': 'properties.$os',
    'context.browser': 'properties.$browser',
    'context.page.host': 'properties.$host',
    'context.page.url': 'properties.$current_url',
    'context.page.path': 'properties.$pathname',
    'context.page.referrer': 'properties.$referrer',
    'context.page.initial_referrer': 'properties.$initial_referrer',
    'context.page.referring_domain': 'properties.$referring_domain',
    'context.app.version': 'properties.posthog_version',
    'context.page.initial_referring_domain': 'properties.$initial_referring_domain',
    'context.browser_version': 'properties.$browser_version',
    'context.screen.height': 'properties.$screen_height',
    'context.screen.width': 'properties.$screen_width',
    'context.library.name': 'properties.$lib',
    'context.library.version': 'properties.$lib_version',
    'context.ip': 'ip',
    messageId: '$insert_id',
    originalTimestamp: 'timestamp',
    userId: ['$user_id', 'distinct_id'],
    anonymousId: ['properties.$anon_distinct_id', 'properties.$device_id', 'properties.distinct_id'],
    'context.active_feature_flags': 'properties.$active_feature_flags',
    'context.posthog_version': 'properties.posthog_version',
    'context.has_slack_webhook': 'properties.has_slack_webhook',
    'context.token': 'properties.token',
}

const autoCapture = {
    event: 'properties.$event_type',
    'properties.elements': 'properties.$elements',
}

const eventToMapping = {
    $identify: { type: 'identify', mapping: identify },
    $create_alias: { type: 'alias', mapping: alias },
    $pageview: { type: 'page', mapping: page },
    $page: { type: 'page', mapping: page },
    $group: { type: 'group', mapping: group },
    $autocapture: { type: 'track', mapping: autoCapture },
    default: { type: 'track', mapping: track },
}

function set(target, path, value) {
    let keys = path.split('.')
    let len = keys.length

    for (let i = 0; i < len; i++) {
        let prop = keys[i]

        if (!isObject(target[prop])) {
            target[prop] = {}
        }

        if (i === len - 1) {
            target[prop] = value
            break
        }

        target = target[prop]
    }
}

function isObject(val) {
    return val !== null && (typeof val === 'object' || typeof val === 'function')
}

function get(target, path) {
    let keys = path.split('.')
    let len = keys.length

    for (let i = 0; i < len; i++) {
        let prop = keys[i]

        if (target[prop] !== undefined) {
            target = target[prop]
        } else {
            return undefined
        }
    }

    return target
}

export async function setupPlugin({ config, global }) {
    global.laudAuthHeader = {
        headers: {
            authorization: `Basic ${config.writeKey}`,
            PublicWriteKey: `Basic ${config.writeKey}`,
        },
    }
    global.writeKey = config.writeKey
    global.dataPlaneUrl = config.dataPlaneUrl
}

function getElementByOrderZero(json) {
  if (!json.elements || !Array.isArray(json.elements)) {
    return null
  }
  return json.elements.find(x => x.order === 0) || null
}


export async function composeDittoFeedWebhook(event, { config, global }) {
    let dittoFeedPayload = {
        userId: '',      // userId should be outside traits
        messageId: '',   // messageId should be outside traits
        event: '',       // event should be outside traits
        traits: {}       // all other properties go inside traits
    };

    // Initialize plugin configuration
    await setupPlugin({ config, global });

    // Add constants to traits
    constructPayload(dittoFeedPayload.traits, event, constants, true);

    // Add generic properties to traits
    constructPayload(dittoFeedPayload.traits, event, generic);

    // Get specific event properties
    const eventName = get(event, 'event');
    const { type, mapping } = eventToMapping[eventName] ? eventToMapping[eventName] : eventToMapping['default'];

    // Set DittoFeed payload type (event)
    dittoFeedPayload.event = type || eventName;

    // Set event properties in traits
    constructPayload(dittoFeedPayload.traits, event, mapping);

    // Add all PostHog properties not starting with $ to traits
    Object.keys(event.properties).forEach((propKey) => {
        if (propKey.slice(0, 1) != '$' && event.properties[propKey] != undefined && event.properties[propKey] != null) {
            set(dittoFeedPayload.traits, propKey, event.properties[propKey]);
        }
    });

    // Check for userId and set it if found
    if (!dittoFeedPayload.userId && ("user_id" in event.properties)) {
        dittoFeedPayload.userId = event.properties["user_id"];
    } else if (!dittoFeedPayload.userId && ("distinct_id" in event.properties)) {
        dittoFeedPayload.userId = event.properties["distinct_id"];
    }

    // Check for messageId and set it if found
    if (!dittoFeedPayload.messageId && ("$insert_id" in event.properties)) {
        dittoFeedPayload.messageId = event.properties["$insert_id"];
    }

    // Set the event name if not set
    if (!dittoFeedPayload.event && "event" in event) {
        dittoFeedPayload.event = event["event"];
    }

    // // Add top-level element if there is a click, change, or submit event
    // if (['click', 'change', 'submit'].includes(dittoFeedPayload.event)) {
    //     dittoFeedPayload.traits['elements'] = [getElementByOrderZero(event)];
    // }
    if (dittoFeedPayload.traits.event){dittoFeedPayload.event = dittoFeedPayload.traits.event}

    // Handle user set traits
    const userSet = get(event, 'properties.$set');
    if (userSet) {
        if (config.phEmail) {
            set(dittoFeedPayload.traits, 'phEmail', userSet[config.phEmail]);
        }

        if (config.phPhoneNumber) {
            set(dittoFeedPayload.traits, 'phPhoneNumber', userSet[config.phPhoneNumber]);
        }

        if (config.phDeviceToken) {
            set(dittoFeedPayload.traits, 'phDeviceToken', userSet[config.phDeviceToken]);
        }

        if (config.phCustom) {
            set(dittoFeedPayload.traits, 'phCustom', userSet[config.phCustom]);
        }
    }

    // Add timestamp for sentAt
    dittoFeedPayload["sentAt"] = new Date().toISOString();

    // Return the constructed request
    return {
        url: global.dataPlaneUrl,
        headers: {
            'Content-Type': 'application/json',
            ...global.laudAuthHeader.headers,
        },
        body: JSON.stringify(dittoFeedPayload),
        method: 'POST',
    };
}

function constructPayload(outPayload, inPayload, mapping, direct = false) {
    Object.keys(mapping).forEach((dittoFeedKeyPath) => {
        let pHKeyPath = mapping[dittoFeedKeyPath]
        let pHKeyVal = undefined
        if (direct) {
            pHKeyVal = pHKeyPath
        } else if (Array.isArray(pHKeyPath)) {
            for (let i = 0; i < pHKeyPath.length; i++) {
                pHKeyVal = get(inPayload, pHKeyPath[i])
                if (pHKeyVal) {
                    break
                }
            }
        } else {
            pHKeyVal = get(inPayload, pHKeyPath)
        }
        if (pHKeyVal != undefined && pHKeyVal != null) {
            set(outPayload, dittoFeedKeyPath, pHKeyVal)
        }
    })
}

