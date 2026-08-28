import argparse
import json

from .avatars import save_avatar_file
from .auth import (
    create_api_key,
    list_api_keys,
    revoke_api_key,
    rotate_api_key,
    set_audio_generation_daily_limit,
    update_api_key,
)
from .db import gist_connection
from .migrations import init_gist_database
from .narration import prune_narrations
from .service import rerender_gists
from .settings import load_settings


class _AppConfig:
    config = {}


def _app():
    _AppConfig.config = load_settings()
    if not _AppConfig.config["SQLITE_DB_PATH"]:
        raise RuntimeError("SQLITE_DB_PATH must be set")
    return _AppConfig


def _add_avatar_arguments(parser):
    avatar = parser.add_mutually_exclusive_group()
    avatar.add_argument("--avatar-url")
    avatar.add_argument("--avatar-file")
    avatar.add_argument("--clear-avatar", action="store_true")


def _avatar_arg(app, args):
    if args.avatar_file:
        return save_avatar_file(app, args.avatar_file)
    if args.clear_avatar:
        return None
    return args.avatar_url


def _audio_limit_arg(value):
    if value == "unlimited":
        return None
    try:
        limit = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "limit must be zero, unlimited, or a positive integer"
        ) from exc
    if limit < 0:
        raise argparse.ArgumentTypeError(
            "limit must be zero, unlimited, or a positive integer"
        )
    return limit


def main(argv=None):
    parser = argparse.ArgumentParser(prog="admin")
    subparsers = parser.add_subparsers(dest="resource", required=True)
    keys = subparsers.add_parser("keys")
    key_commands = keys.add_subparsers(dest="command", required=True)

    create = key_commands.add_parser("create")
    create.add_argument("--name", required=True)
    create.add_argument("--github-login")
    _add_avatar_arguments(create)

    key_commands.add_parser("list")

    revoke = key_commands.add_parser("revoke")
    revoke.add_argument("key_prefix_or_id")

    update = key_commands.add_parser("update")
    update.add_argument("key_prefix_or_id")
    update.add_argument("--name")
    update.add_argument("--github-login")
    _add_avatar_arguments(update)

    rotate = key_commands.add_parser("rotate")
    rotate.add_argument("key_prefix_or_id")
    rotate.add_argument("--name")
    rotate.add_argument("--github-login")
    _add_avatar_arguments(rotate)

    audio_limit = key_commands.add_parser("audio-limit")
    audio_limit.add_argument("key_prefix_or_id")
    audio_limit.add_argument(
        "limit",
        type=_audio_limit_arg,
        help="disabled (0), unlimited, or a positive daily limit",
    )

    gists = subparsers.add_parser("gists")
    gist_commands = gists.add_subparsers(dest="command", required=True)

    rerender = gist_commands.add_parser("rerender")
    rerender_target = rerender.add_mutually_exclusive_group(required=True)
    rerender_target.add_argument("--id", dest="external_id")
    rerender_target.add_argument("--all", action="store_true")
    rerender.add_argument("--dry-run", action="store_true")

    narrations = subparsers.add_parser("narrations")
    narration_commands = narrations.add_subparsers(dest="command", required=True)
    prune = narration_commands.add_parser("prune")
    prune.add_argument("--target-bytes", required=True, type=int)

    args = parser.parse_args(argv)
    app = _app()
    init_gist_database(app)

    if args.resource == "keys":
        with gist_connection(app) as conn:
            if args.command == "create":
                result = create_api_key(
                    conn,
                    args.name,
                    github_login=args.github_login,
                    avatar_url=_avatar_arg(app, args),
                )
                print(json.dumps(result, indent=2))
                print("Save this key securely.")
            elif args.command == "list":
                print(json.dumps(list_api_keys(conn), indent=2))
            elif args.command == "revoke":
                revoke_api_key(conn, args.key_prefix_or_id)
                print(json.dumps({"revoked": True}, indent=2))
            elif args.command == "update":
                avatar_args_present = (
                    args.avatar_url is not None or args.avatar_file or args.clear_avatar
                )
                update_kwargs = {}
                if args.github_login is not None:
                    update_kwargs["github_login"] = args.github_login
                if avatar_args_present:
                    update_kwargs["avatar_url"] = _avatar_arg(app, args)
                result = update_api_key(
                    conn,
                    args.key_prefix_or_id,
                    args.name,
                    **update_kwargs,
                )
                print(json.dumps(result, indent=2))
            elif args.command == "rotate":
                avatar_args_present = (
                    args.avatar_url is not None or args.avatar_file or args.clear_avatar
                )
                rotate_kwargs = {}
                if args.github_login is not None:
                    rotate_kwargs["github_login"] = args.github_login
                if avatar_args_present:
                    rotate_kwargs["avatar_url"] = _avatar_arg(app, args)
                result = rotate_api_key(
                    conn,
                    args.key_prefix_or_id,
                    args.name,
                    **rotate_kwargs,
                )
                print(json.dumps(result, indent=2))
                print("Save this key securely.")
            elif args.command == "audio-limit":
                result = set_audio_generation_daily_limit(
                    conn,
                    args.key_prefix_or_id,
                    args.limit,
                )
                print(json.dumps(result, indent=2))
    elif args.resource == "gists":
        if args.command == "rerender":
            result = rerender_gists(
                app,
                external_id=args.external_id,
                dry_run=args.dry_run,
            )
            print(json.dumps(result, indent=2))
    elif args.resource == "narrations":
        if args.command == "prune":
            print(
                json.dumps(
                    prune_narrations(app, args.target_bytes),
                    indent=2,
                )
            )


if __name__ == "__main__":
    main()
