'use strict'

const PRIVATE_CHANNEL_INDEX = 7,
      PRIVATE_CHANNEL_ID = -2 >>> 0,
      PUBLIC_MATCH = /^!([^!].*)$/


class CommandBase {
    constructor(mod) {
        this.mod = mod;
        this.loaded = false;
        this.hooks = {};

        mod.hook('S_LOGIN', 'raw', () => { this.loaded = false });

        mod.hook('S_LOAD_CLIENT_USER_SETTING', 'raw', () => {
            if(!this.loaded) {
                this.loaded = true;
                process.nextTick(() => {
                    mod.send('S_JOIN_PRIVATE_CHANNEL', 1, {
                        index: PRIVATE_CHANNEL_INDEX,
                        id: PRIVATE_CHANNEL_ID,
                        unk: [],
                        name: this.mod.settings.private_channel_name,
                    });

                    if (this.mod.settings.login_message)
                        this.message(null, `Client ${this.mod.majorPatchVersion}.${this.mod.minorPatchVersion} - Protocol ${this.mod.protocolVersion}`);
                });
            }
        })

        mod.hook('S_JOIN_PRIVATE_CHANNEL', 1, event => event.index == PRIVATE_CHANNEL_INDEX ? false : undefined);
        mod.hook('C_LEAVE_PRIVATE_CHANNEL', 1, event => event.index == PRIVATE_CHANNEL_INDEX ? false : undefined);

        mod.hook('C_REQUEST_PRIVATE_CHANNEL_INFO', 1, event => {
            if(event.channelId === PRIVATE_CHANNEL_ID) {
                mod.send('S_REQUEST_PRIVATE_CHANNEL_INFO', 1, {
                    owner: 1,
                    password: 0,
                    members: [],
                    friends: []
                });
                return false;
            }
        });

        let lastError,
            hookCommand = message => {
                let args = null

                try {
                    args = parseArgs(stripOuterHTML(message))
                } catch(e) {
                    return 'Syntax error: ' + e.message
                }

                try {
                    if(!this.exec(args))
                        return 'Unknown command "' + args[0] + '".'
                } catch(e) {
                    this.message(null, 'Error running callback for command "' + args[0] + '".')
                    console.error(e)
                }
            }

        mod.hook('C_CHAT', 1, {order: -10}, event => {
            if(event.channel === 11 + PRIVATE_CHANNEL_INDEX) {
                lastError = hookCommand(event.message);
                if(!lastError)
                    return false;
            } else if(this.mod.settings.public_enable) {
                const str = PUBLIC_MATCH.exec(stripOuterHTML(event.message));

                if(str) {
                    lastError = hookCommand(str[1]);
                    if(!lastError)
                        return false;
                }
            }
        });

        // Let other modules handle possible commands before we silence them
        mod.hook('C_CHAT', 1, {order: 10, filter: {silenced: null}}, event => {
            if(lastError) {
                if(!event.$silenced)
                    this.message(null, lastError);
                lastError = undefined;
                return false;
            }
        });

        mod.hook('C_WHISPER', 1, {order: -10}, event => {
            if(!this.mod.settings.public_enable)
                return;

            const str = PUBLIC_MATCH.exec(stripOuterHTML(event.message));

            if(str) {
                lastError = hookCommand(str[1]);
                if(!lastError)
                    return false;
            }
        });

        // Let other modules handle possible commands before we silence them
        mod.hook('C_WHISPER', 1, {order: 10, filter: {silenced: null}}, event => {
            if(!this.mod.settings.public_enable)
                return;

            if(lastError) {
                if(!event.$silenced)
                    this.message(null, lastError);
                lastError = undefined;
                return false;
            }
        });

        // Add own commands
        this.add('proxy', {
            $default() {
                this.message(null, `Proxy commands:`)
                this.message(null, `onlychannel - Toggles ability to enter commands in proxy channel only (recommended) or all channels`)
                this.message(null, `loginmessage - Toggles proxy status message shown on login`)
            },
            onlychannel() {
                this.mod.settings.public_enable = !this.mod.settings.public_enable;
                this.message(null, `Commands can now be entered in ${this.mod.settings.public_enable ? 'all chat channels' : 'proxy channel only'}`);
            },
            loginmessage() {
                this.mod.settings.login_message = !this.mod.settings.login_message;
                this.message(null, `Proxy login message ${this.mod.settings.login_message ? 'enabled' : 'disabled'}`);
            },
        }, this);
    }

    exec(str) {
        const args = Array.isArray(str) ? str : parseArgs(str);
        if(args.length === 0)
            return false;

        const cb = this.hooks[args[0].toLowerCase()];

        if(cb) {
            cb.call(...args);
            return true;
        }

        return false;
    }

    add(cmd, cb, ctx) {
        if(typeof cb === 'function') {
            if(ctx !== undefined)
                cb = cb.bind(ctx)
        } else if(typeof cb === 'object') {
            cb = makeSubCommandHandler(cb, ctx);
        } else {
            throw new Error('Callback must be a function or object');
        }

        if(Array.isArray(cmd)) {
            for(let c of cmd)
                this.add(c, cb);
            return;
        }

        if(typeof cmd !== 'string')
            throw new Error('Command must be a string or array of strings');
        if(cmd === '')
            throw new Error('Command must not be an empty string');

        cmd = cmd.toLowerCase();
        if(this.hooks[cmd])
            throw new Error('Command already registered:', cmd);

        this.hooks[cmd] = cb;
    }

    remove(cmd) {
        if(Array.isArray(cmd)) {
            for(let c of cmd)
                this.remove(c);
            return;
        }

        if(typeof cmd !== 'string')
            throw new Error('Command must be a string or array of strings');
        if(cmd === '')
            throw new Error('Command must not be an empty string');

        delete this.hooks[cmd.toLowerCase()];
    }

    message(modName, msg) {
        this.mod.send('S_PRIVATE_CHAT', 1, {
            channel: PRIVATE_CHANNEL_ID,
            authorID: 0,
            authorName: '',
            message: (modName && !this.mod.settings.hide_module_names) ? `[${modName}] ${msg}` : ` ${msg}`,
        });
    }
}

function makeSubCommandHandler(_obj, ctx) {
    const obj = {};

    for(let cmd in _obj) {
        const cb = _obj[cmd];

        cmd = cmd.toLowerCase();

        if(typeof cb === 'function')
            obj[cmd] = ctx !== undefined ? cb.bind(ctx) : cb;
        else if(typeof cb === 'object')
            obj[cmd] = makeSubCommandHandler(cb, ctx);
        else
            throw new Error('Sub-command callback must be a function or object');
    }

    return function subCommandHandler(cmd) {
        const cb = (cmd !== undefined ? obj[cmd.toLowerCase()] : obj.$none) || obj.$default;

        if(cb)
            cb.apply(null, (arguments && cb !== obj.$default) ? Array.prototype.slice.call(arguments, 1) : arguments);
    }
}

function stripOuterHTML(str) {
    return str.replace(/^<[^>]+>|<\/[^>]+><[^\/][^>]*>|<\/[^>]+>$/g, '');
}

function parseArgs(str) {
    const parseHTML = /.*?<\/.*?>/g,
        args = [];

    let arg = '',
        quote = '';

    for(let i = 0, c = ''; i < str.length; i++) {
        c = str[i];

        switch(c) {
            case '<':
                parseHTML.lastIndex = i + 1;

                let len = parseHTML.exec(str);

                if(!len)
                    throw new Error('HTML parsing failure');

                len = len[0].length;
                arg += str.substr(i, len + 1);
                i += len;
                break;
            case '\\':
                c = str[++i];

                if(c === undefined)
                    throw new Error('Unexpected end of line');

                arg += c;
                break;
            case '\'':
            case '"':
                if(arg === '' && quote === '') {
                    quote = c;
                    break;
                }
                if(quote === c) {
                    quote = '';
                    break;
                }
                arg += c;
                break
            case ' ':
                if(quote === '') {
                    if(arg !== '') {
                        args.push(arg);
                        arg = '';
                    }
                    break;
                }
            default:
                arg += c;
        }
    }

    if(arg !== '') {
        if(quote !== '')
            throw new Error('Expected ' + quote);

        args.push(arg);
    }

    return args;
}

// TODO FIXME: remove this ugly-ass shit code once mods are ported to new require() stuff.
if(!global.__CommandInstanceMap__)
    global.__CommandInstanceMap__ = new WeakMap();

function InitCommandBase(mod) {
    if(global.__CommandInstanceMap__.has(mod.dispatch))
        return global.__CommandInstanceMap__.get(mod.dispatch);

    const instance = new CommandBase(mod);
    global.__CommandInstanceMap__.set(mod.dispatch, instance);
    return instance;
}

class Command {
    constructor(mod) {
        this.mod = mod;
        this.base = InitCommandBase(mod);
    }

    exec(str) {
        return this.base.exec(str);
    }

    add(cmd, cb, ctx) {
        return this.base.add(cmd, cb, ctx);
    }

    remove(cmd) {
        return this.base.remove(cmd);
    }

    message(msg) {
        return this.base.message(this.mod.niceName, msg);
    }

    createInstance(mod) {
        return new Command(mod);
    }
}

module.exports = function Wrapper(mod) {
    if(mod.name !== 'command')
        console.log(`WARNING FOR DEVELOPERS: In ${mod.name} - require()'ing command is deprecated, use mod.command instead!`);

    return new Command(mod);
}
